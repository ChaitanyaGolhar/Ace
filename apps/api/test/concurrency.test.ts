import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PullResponse } from '@recall/core';
import { closeTestPrisma, makeTestApp, resetDb, signIn } from './helpers';
import { card, deck, log, pull, push } from './syncFixtures';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

const idsOf = (page: PullResponse) =>
  [...page.decks, ...page.cards, ...page.reviewLogs].map((r) => r.id);

describe('concurrent pushes for one user', () => {
  it('a full pull returns every row, and incremental pulls running alongside never skip one', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');

    // Four batches, each its own deck with cards and logs (~200 rows per batch).
    const batches = Array.from({ length: 4 }, () => {
      const d = deck();
      const cards = Array.from({ length: 60 }, () => card(d.id));
      return { decks: [d], cards, reviewLogs: cards.flatMap((c) => [log(c.id), log(c.id)]) };
    });
    const allIds = new Set(
      batches.flatMap((b) => [...b.decks, ...b.cards, ...b.reviewLogs].map((r) => r.id)),
    );

    // An incremental puller, as a second device would run it, polling while the pushes run.
    const seen = new Set<string>();
    let cursor = '0';
    // An object, not a `let`: TypeScript can't see the flag change from outside the loop.
    const flag = { pushing: true };
    const puller = (async () => {
      while (flag.pushing) {
        const page = (await pull(t, cookie, cursor, 50)).body as PullResponse;
        for (const id of idsOf(page)) seen.add(id);
        cursor = page.nextCursor;
        if (!page.hasMore) await new Promise((r) => setTimeout(r, 5));
      }
    })();

    const results = await Promise.all(batches.map((b) => push(t, cookie, b)));
    flag.pushing = false;
    await puller;
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);

    // Catch up from wherever the incremental puller stopped.
    for (;;) {
      const page = (await pull(t, cookie, cursor, 50)).body as PullResponse;
      for (const id of idsOf(page)) seen.add(id);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(allIds);

    // A full pull from cursor 0 returns every row exactly once.
    const full: string[] = [];
    let c = '0';
    for (;;) {
      const page = (await pull(t, cookie, c, 500)).body as PullResponse;
      full.push(...idsOf(page));
      c = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(full).toHaveLength(allIds.size);
    expect(new Set(full)).toEqual(allIds);
  });

  it('a small push that starts during a big one never lets a puller skip the big one’s rows', async () => {
    // The race the advisory lock prevents (§8.1): the big push takes low serverSeqs early
    // but commits late; a small push started meanwhile takes higher seqs and, without the
    // lock, commits first. A pull in between would move its cursor past the big push's
    // seqs before they commit, and never see those rows. With the lock the small push
    // waits, so this passes regardless of timing; without it, it fails.
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    for (let round = 0; round < 3; round++) {
      const bigDeck = deck();
      const bigCards = Array.from({ length: 249 }, () => card(bigDeck.id));
      const big = {
        decks: [bigDeck],
        cards: bigCards,
        reviewLogs: bigCards.map((c) => log(c.id)),
      };
      const small = { decks: [deck()] };
      const expected = new Set([
        bigDeck.id,
        ...bigCards.map((c) => c.id),
        ...big.reviewLogs.map((l) => l.id),
        small.decks[0]?.id ?? '',
      ]);

      // Start from the current end of the change log (earlier rounds' rows excluded).
      let cursor = '0';
      for (;;) {
        const page = (await pull(t, cookie, cursor, 500)).body as PullResponse;
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
      const seen = new Set<string>();
      const flag = { running: true };
      const puller = (async () => {
        while (flag.running) {
          const page = (await pull(t, cookie, cursor, 500)).body as PullResponse;
          for (const id of idsOf(page)) seen.add(id);
          cursor = page.nextCursor;
          await new Promise((r) => setTimeout(r, 2));
        }
      })();

      // Start the small push only once the big one is mid-way through inserting. Sequence
      // values are non-transactional, so change_seq visibly advances even though none of
      // the big push's rows are committed yet.
      const seqNow = async () =>
        BigInt(
          (
            await t.prisma.$queryRawUnsafe<{ v: string }[]>(
              'SELECT last_value::text AS v FROM change_seq',
            )
          )[0]?.v ?? '0',
        );
      const seqBefore = await seqNow();
      // Promise.resolve(...) sends the request now: a supertest request is lazy and is
      // only sent when something calls .then() on it.
      const bigPush = Promise.resolve(push(t, cookie, big));
      const deadline = Date.now() + 10_000;
      while ((await seqNow()) < seqBefore + 50n && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1));
      }
      const smallPush = Promise.resolve(push(t, cookie, small));
      expect((await smallPush).status).toBe(200);
      expect((await bigPush).status).toBe(200);
      flag.running = false;
      await puller;
      for (;;) {
        const page = (await pull(t, cookie, cursor, 500)).body as PullResponse;
        for (const id of idsOf(page)) seen.add(id);
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
      expect(seen).toEqual(expected);
    }
  });

  it('two pushes racing on the same rows converge to the LWW winner', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    await push(t, cookie, { decks: [d] }).expect(200);
    const older = { ...d, name: 'older', updatedAt: d.updatedAt + 1 };
    const newer = { ...d, name: 'newer', updatedAt: d.updatedAt + 2 };
    await Promise.all([push(t, cookie, { decks: [newer] }), push(t, cookie, { decks: [older] })]);
    const page = (await pull(t, cookie)).body as PullResponse;
    expect(page.decks.map((x) => x.name)).toEqual(['newer']);
  });
});

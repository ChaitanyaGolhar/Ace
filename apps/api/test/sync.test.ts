import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PullResponse } from '@recall/core';
import { closeTestPrisma, DAY, HOUR, makeTestApp, resetDb, signIn, T0 } from './helpers';
import { card, deck, dump, log, pull, push } from './syncFixtures';
import { TEST_DATABASE_URL } from './testDb';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

async function setup() {
  const t = makeTestApp();
  const cookie = await signIn(t, 'a@example.com');
  return { t, cookie };
}

const body = (res: { body: unknown }) => res.body as PullResponse;

describe('POST /sync/push', () => {
  it('requires a session', async () => {
    const t = makeTestApp();
    const res = await request(t.app).post('/sync/push').send({});
    expect(res.status).toBe(401);
  });

  it('stores decks, cards and logs for the session’s user and lists accepted ids', async () => {
    const { t, cookie } = await setup();
    const d = deck();
    const c = card(d.id);
    const l = log(c.id);
    const res = await push(t, cookie, { decks: [d], cards: [c], reviewLogs: [l] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accepted: { decks: [d.id], cards: [c.id], reviewLogs: [l.id], events: [] },
    });
    const pulled = body(await pull(t, cookie));
    expect(pulled.decks).toEqual([d]);
    expect(pulled.cards).toEqual([c]);
    expect(pulled.reviewLogs).toEqual([l]);
  });

  it('rejects the whole batch on a schema error (400), writing nothing', async () => {
    const { t, cookie } = await setup();
    const d = deck();
    const res = await push(t, cookie, { decks: [d], cards: [card(d.id, { front: '' })] });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('invalid_request');
    expect((await dump(t)).decks).toEqual([]);
  });

  it('enforces the max lengths and the 500-row limit (400)', async () => {
    const { t, cookie } = await setup();
    const d = deck();
    expect((await push(t, cookie, { decks: [deck({ name: 'x'.repeat(201) })] })).status).toBe(400);
    expect(
      (await push(t, cookie, { decks: [d], cards: [card(d.id, { back: 'y'.repeat(20_001) })] }))
        .status,
    ).toBe(400);
    const c = card(d.id);
    const logs = Array.from({ length: 499 }, () => log(c.id));
    expect((await push(t, cookie, { decks: [d], cards: [c], reviewLogs: logs })).status).toBe(400);
  });

  it('is idempotent: the same batch twice gives the same database state', async () => {
    const { t, cookie } = await setup();
    const d = deck();
    const c = card(d.id);
    const batch = { decks: [d], cards: [c], reviewLogs: [log(c.id), log(c.id, { voidedAt: T0 })] };
    await push(t, cookie, batch).expect(200);
    const once = await dump(t);
    await push(t, cookie, batch).expect(200);
    expect(await dump(t)).toEqual(once);
  });

  describe('decks and cards: last-write-wins', () => {
    it('a newer edit overwrites and gets a new serverSeq; an older one is ignored', async () => {
      const { t, cookie } = await setup();
      const d = deck({ name: 'v1', updatedAt: T0 });
      await push(t, cookie, { decks: [d] }).expect(200);
      const cursor = body(await pull(t, cookie)).nextCursor;

      await push(t, cookie, { decks: [{ ...d, name: 'v2', updatedAt: T0 + 1 }] }).expect(200);
      let changed = body(await pull(t, cookie, cursor));
      expect(changed.decks.map((x) => x.name)).toEqual(['v2']);

      const cursor2 = changed.nextCursor;
      await push(t, cookie, { decks: [{ ...d, name: 'stale', updatedAt: T0 }] }).expect(200);
      changed = body(await pull(t, cookie, cursor2));
      expect(changed.decks).toEqual([]);
      expect(body(await pull(t, cookie)).decks[0]?.name).toBe('v2');
    });

    it('equal updatedAt falls back to the same rule as core lww (deterministic)', async () => {
      const { t, cookie } = await setup();
      const d = deck({ name: 'a' });
      await push(t, cookie, { decks: [d] }).expect(200);
      await push(t, cookie, { decks: [{ ...d, name: 'b' }] }).expect(200);
      await push(t, cookie, { decks: [{ ...d, name: 'a' }] }).expect(200);
      // Content tie-break: the greater canonical serialisation wins ("b" > "a").
      expect(body(await pull(t, cookie)).decks[0]?.name).toBe('b');
    });

    it('tombstones are sticky: a later edit can’t resurrect a deleted card', async () => {
      const { t, cookie } = await setup();
      const d = deck();
      const c = card(d.id);
      await push(t, cookie, {
        decks: [d],
        cards: [{ ...c, deletedAt: T0 + 1, updatedAt: T0 + 1 }],
      }).expect(200);
      await push(t, cookie, { cards: [{ ...c, front: 'edited', updatedAt: T0 + 5 }] }).expect(200);
      const stored = body(await pull(t, cookie)).cards[0];
      expect(stored?.deletedAt).toBe(T0 + 1);
      expect(stored?.front).toBe('front');
    });

    it('a card must reference a deck of this user, in the batch or already stored', async () => {
      const { t, cookie } = await setup();
      const res = await push(t, cookie, { cards: [card(deck().id)] });
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('unknown_deck');

      const d = deck();
      await push(t, cookie, { decks: [d] }).expect(200);
      await push(t, cookie, { cards: [card(d.id)] }).expect(200);
    });
  });

  describe('review logs', () => {
    it('are inserted if absent; a different copy of an existing log never changes it', async () => {
      const { t, cookie } = await setup();
      const d = deck();
      const c = card(d.id);
      const l = log(c.id, { rating: 3 });
      await push(t, cookie, { decks: [d], cards: [c], reviewLogs: [l] }).expect(200);
      const before = await dump(t);
      await push(t, cookie, { reviewLogs: [{ ...l, rating: 1, durationMs: 9 }] }).expect(200);
      expect(await dump(t)).toEqual(before);
    });

    it('voidedAt: set when the stored log has none, never cleared, earliest wins', async () => {
      const { t, cookie } = await setup();
      const d = deck();
      const c = card(d.id);
      const l = log(c.id);
      await push(t, cookie, { decks: [d], cards: [c], reviewLogs: [l] }).expect(200);
      const cursor = body(await pull(t, cookie)).nextCursor;

      await push(t, cookie, { reviewLogs: [{ ...l, voidedAt: T0 + 50 }] }).expect(200);
      const changed = body(await pull(t, cookie, cursor));
      expect(changed.reviewLogs).toEqual([{ ...l, voidedAt: T0 + 50 }]); // new serverSeq

      await push(t, cookie, { reviewLogs: [l] }).expect(200); // null never clears it
      await push(t, cookie, { reviewLogs: [{ ...l, voidedAt: T0 + 90 }] }).expect(200); // later loses
      expect(body(await pull(t, cookie)).reviewLogs[0]?.voidedAt).toBe(T0 + 50);
      await push(t, cookie, { reviewLogs: [{ ...l, voidedAt: T0 + 10 }] }).expect(200); // earlier wins
      expect(body(await pull(t, cookie)).reviewLogs[0]?.voidedAt).toBe(T0 + 10);
    });
  });

  it('ownership: a row that exists under another user rejects the whole batch (403)', async () => {
    const t = makeTestApp();
    const alice = await signIn(t, 'alice@example.com');
    const bob = await signIn(t, 'bob@example.com');
    const d = deck();
    await push(t, alice, { decks: [d] }).expect(200);

    const mine = deck();
    const res = await push(t, bob, { decks: [mine, { ...d, name: 'stolen', updatedAt: T0 + 9 }] });
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('forbidden');
    expect(body(await pull(t, bob)).decks).toEqual([]);
    expect(body(await pull(t, alice)).decks[0]?.name).toBe('Deck');
  });

  it('clamps timestamps more than 24h in the future to now, with a warning', async () => {
    const { t, cookie } = await setup();
    const future = t.now() + 2 * DAY;
    const d = deck({ createdAt: future, updatedAt: future });
    const c = card(d.id);
    await push(t, cookie, {
      decks: [d],
      cards: [c],
      reviewLogs: [log(c.id, { reviewedAt: future })],
    }).expect(200);
    const pulled = body(await pull(t, cookie));
    expect(pulled.decks[0]?.updatedAt).toBe(t.now());
    expect(pulled.reviewLogs[0]?.reviewedAt).toBe(t.now());
    expect(t.warnings.some((w) => w.includes('in the future'))).toBe(true);
    // Within 24h is left alone.
    const soon = t.now() + 23 * HOUR;
    await push(t, cookie, { decks: [deck({ updatedAt: soon })] }).expect(200);
    expect(body(await pull(t, cookie)).decks.some((x) => x.updatedAt === soon)).toBe(true);
  });

  it('takes the per-user advisory lock (a push waits while another transaction holds it)', async () => {
    const { t, cookie } = await setup();
    const me = (await request(t.app).get('/me').set('Cookie', cookie)).body as { id: string };
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [me.id]);
      let done = false;
      const pending = push(t, cookie, { decks: [deck()] }).then((res) => {
        done = true;
        return res;
      });
      await new Promise((r) => setTimeout(r, 750));
      expect(done).toBe(false); // blocked on the lock
      await client.query('COMMIT');
      expect((await pending).status).toBe(200);
    } finally {
      await client.end();
    }
  });
});

describe('GET /sync/pull', () => {
  it('requires a session and validates the query', async () => {
    const { t, cookie } = await setup();
    expect((await request(t.app).get('/sync/pull')).status).toBe(401);
    expect((await pull(t, cookie, 'abc')).status).toBe(400);
    expect((await pull(t, cookie, '0', 501)).status).toBe(400);
  });

  it('returns only this user’s rows', async () => {
    const t = makeTestApp();
    const alice = await signIn(t, 'alice@example.com');
    const bob = await signIn(t, 'bob@example.com');
    await push(t, alice, { decks: [deck()] }).expect(200);
    const res = body(await pull(t, bob));
    expect(res).toEqual({
      decks: [],
      cards: [],
      reviewLogs: [],
      events: [],
      nextCursor: '0',
      hasMore: false,
    });
  });

  it('pages in serverSeq order with nextCursor and hasMore, without gaps or repeats', async () => {
    const { t, cookie } = await setup();
    const decks = Array.from({ length: 3 }, () => deck());
    const cards = decks.flatMap((d) => [card(d.id), card(d.id)]);
    const logs = cards.map((c) => log(c.id));
    await push(t, cookie, { decks, cards, reviewLogs: logs }).expect(200);

    const seen: string[] = [];
    let cursor = '0';
    let pages = 0;
    for (;;) {
      const page = body(await pull(t, cookie, cursor, 4));
      pages += 1;
      const ids = [...page.decks, ...page.cards, ...page.reviewLogs].map((r) => r.id);
      expect(ids.length).toBeLessThanOrEqual(4);
      seen.push(...ids);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(pages).toBe(4); // 15 rows in pages of 4
    expect(seen).toHaveLength(15);
    expect(new Set(seen).size).toBe(15);
    // Pulling again from the final cursor returns nothing.
    const after = body(await pull(t, cookie, cursor, 4));
    expect(after.hasMore).toBe(false);
    expect([...after.decks, ...after.cards, ...after.reviewLogs]).toEqual([]);
  });
});

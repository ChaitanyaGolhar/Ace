import { describe, expect, it, vi } from 'vitest';
import { initialize } from '../src/services/bootstrap';
import { createCard, deleteCard } from '../src/services/cards';
import { createDeck, renameDeck } from '../src/services/decks';
import { exportBackup, importBackup, BackupError } from '../src/services/backup';
import { rateCard, undoLastReview } from '../src/services/review';
import { searchEverything } from '../src/services/search';
import { requestMagicLink } from '../src/services/signIn';
import { makeTestContext, MINUTE, T0, type TestContext } from './helpers';

async function fresh(start = T0): Promise<TestContext> {
  const ctx = makeTestContext(start);
  await initialize(ctx, { requestPersist: undefined });
  return ctx;
}

describe('backup export / import', () => {
  async function populated() {
    const ctx = await fresh();
    const deck = await createDeck(ctx, 'Bio');
    const a = await createCard(ctx, deck.id, 'a', '1');
    const b = await createCard(ctx, deck.id, 'b', '2');
    const gone = await createCard(ctx, deck.id, 'c', '3');
    await deleteCard(ctx, gone.id);
    await rateCard(ctx, { cardId: a.id, rating: 3, durationMs: 1000 });
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: b.id, rating: 1, durationMs: 1000 });
    ctx.advance(MINUTE);
    await undoLastReview(ctx, T0);
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: b.id, rating: 4, durationMs: 1000 });
    return ctx;
  }

  async function snapshot(ctx: TestContext) {
    const [decks, cards, reviewLogs, cardStates] = await Promise.all([
      ctx.db.decks.toArray(),
      ctx.db.cards.toArray(),
      ctx.db.reviewLogs.toArray(),
      ctx.db.cardStates.toArray(),
    ]);
    return { decks, cards, reviewLogs, cardStates };
  }

  it('exports decks, cards and logs without local-only fields', async () => {
    const ctx = await populated();
    const backup = await exportBackup(ctx);
    expect(backup.format).toBe('recall-backup');
    expect(backup.version).toBe(2); // M6: typed cards and outcomes
    expect(backup.decks).toHaveLength(1);
    expect(backup.cards).toHaveLength(3); // tombstones included, so deletes carry over
    expect(backup.reviewLogs).toHaveLength(3); // undone log included (voided)
    expect(JSON.stringify(backup)).not.toMatch(/dirty|localVersion/);
  });

  it('importing into a fresh install reproduces identical CardStates', async () => {
    const source = await populated();
    const backup = JSON.parse(JSON.stringify(await exportBackup(source))) as unknown;
    const target = await fresh(T0 + 3_600_000);
    await importBackup(target, backup);
    const byId = (s: { cardId: string }[]) => [...s].sort((x, y) => (x.cardId < y.cardId ? -1 : 1));
    expect(byId(await target.db.cardStates.toArray())).toEqual(
      byId(await source.db.cardStates.toArray()),
    );
  });

  it('importing the same backup twice changes nothing', async () => {
    const source = await populated();
    const backup = await exportBackup(source);
    const target = await fresh();
    const first = await importBackup(target, backup);
    expect(first).toEqual({ decks: 1, cards: 3, reviewLogs: 3 });
    const after1 = await snapshot(target);
    const second = await importBackup(target, backup);
    expect(second).toEqual({ decks: 0, cards: 0, reviewLogs: 0 });
    expect(await snapshot(target)).toEqual(after1);
  });

  it('re-importing your own backup changes nothing', async () => {
    const ctx = await populated();
    const before = await snapshot(ctx);
    expect(await importBackup(ctx, await exportBackup(ctx))).toEqual({
      decks: 0,
      cards: 0,
      reviewLogs: 0,
    });
    expect(await snapshot(ctx)).toEqual(before);
  });

  it('merges with the same rules as sync: newer edits win, tombstones and undos stick', async () => {
    const ctx = await populated();
    const backup = await exportBackup(ctx);
    const deck = backup.decks[0];
    if (!deck) throw new Error('no deck');
    ctx.advance(MINUTE);
    await renameDeck(ctx, deck.id, 'Newer local name');
    await importBackup(ctx, backup);
    expect((await ctx.db.decks.get(deck.id))?.name).toBe('Newer local name');

    // An older backup can't resurrect a deleted card or un-undo a review.
    const other = await fresh();
    await importBackup(other, backup);
    const card = backup.cards.find((c) => c.deletedAt === null);
    if (!card) throw new Error('no live card');
    await deleteCard(other, card.id);
    await importBackup(other, backup);
    expect((await other.db.cards.get(card.id))?.deletedAt).not.toBeNull();
  });

  it('marks changed rows dirty so they sync later', async () => {
    const source = await populated();
    const target = await fresh();
    await importBackup(target, await exportBackup(source));
    expect((await target.db.decks.toArray()).every((d) => d.dirty === 1)).toBe(true);
    expect((await target.db.reviewLogs.toArray()).every((l) => l.dirty === 1)).toBe(true);
  });

  it('rejects an invalid file without writing anything', async () => {
    const ctx = await fresh();
    await expect(importBackup(ctx, { hello: 'world' })).rejects.toThrow(BackupError);
    await expect(
      importBackup(ctx, {
        format: 'recall-backup',
        version: 1,
        exportedAt: T0,
        decks: [],
        cards: [{ id: 'bad' }],
        reviewLogs: [],
      }),
    ).rejects.toThrow(BackupError);
    expect(await ctx.db.cards.count()).toBe(0);
  });
});

describe('searchEverything', () => {
  it('finds decks by name and live cards by question or answer text', async () => {
    const ctx = await fresh();
    const bio = await createDeck(ctx, 'Biology');
    const db = await createDeck(ctx, 'Databases');
    await createCard(ctx, bio.id, 'What is a cell?', 'The basic unit of life');
    const acid = await createCard(ctx, db.id, 'ACID?', 'Atomicity, Consistency…');
    const gone = await createCard(ctx, db.id, 'atom bomb', 'no');
    await deleteCard(ctx, gone.id);

    const results = await searchEverything(ctx, '  ATOM ');
    expect(results.decks).toEqual([]);
    expect(results.cards).toEqual([
      { id: acid.id, deckId: db.id, deckName: 'Databases', front: 'ACID?' },
    ]);
    expect((await searchEverything(ctx, 'bio')).decks.map((d) => d.name)).toEqual(['Biology']);
    expect(await searchEverything(ctx, ' ')).toEqual({ decks: [], cards: [] });
  });
});

describe('requestMagicLink', () => {
  const ok = () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 202 }));

  it('POSTs the email to /auth/magic-link with credentials', async () => {
    const fetchFn = vi.fn(ok);
    expect(
      await requestMagicLink('a@example.com', { apiUrl: 'http://api.test', fetch: fetchFn }),
    ).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: 'a@example.com' }),
    });
  });

  it('maps failures to reasons the UI can explain', async () => {
    const respond = (status: number) => () => Promise.resolve(new Response('{}', { status }));
    const opts = (f: typeof fetch) => ({ apiUrl: 'http://api.test', fetch: f });
    expect(await requestMagicLink('a@example.com', opts(respond(400)))).toEqual({
      ok: false,
      reason: 'invalid_email',
    });
    expect(await requestMagicLink('a@example.com', opts(respond(429)))).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    expect(await requestMagicLink('a@example.com', opts(respond(500)))).toEqual({
      ok: false,
      reason: 'server',
    });
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await requestMagicLink('a@example.com', opts(offline))).toEqual({
      ok: false,
      reason: 'network',
    });
  });

  it('rejects an obviously invalid email without calling the API', async () => {
    const fetchFn = vi.fn(ok);
    expect(
      await requestMagicLink('not an email', { apiUrl: 'http://api.test', fetch: fetchFn }),
    ).toEqual({ ok: false, reason: 'invalid_email' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

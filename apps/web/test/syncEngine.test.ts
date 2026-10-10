import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replay } from '@recall/core';
import { getMeta } from '../src/db/meta';
import { initialize } from '../src/services/bootstrap';
import { createCard, deleteCard, updateCard } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import { rateCard, undoLastReview } from '../src/services/review';
import { SyncEngine } from '../src/sync/engine';
import { buildPushBatch, syncOnce } from '../src/sync/syncOnce';
import { FakeServer, fakeTransport } from './fakeServer';
import { makeTestContext, MINUTE, T0 } from './helpers';

async function device(start = T0) {
  const ctx = makeTestContext(start);
  await initialize(ctx, { requestPersist: undefined });
  return ctx;
}

describe('buildPushBatch', () => {
  it('takes dirty decks, then cards, then logs, without local-only fields', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 });
    const { request, snapshot } = await buildPushBatch(ctx, 'dev');
    expect(request.decks.map((d) => d.id)).toEqual([deck.id]);
    expect(request.cards.map((c) => c.id)).toEqual([card.id]);
    expect(request.reviewLogs).toHaveLength(1);
    expect(JSON.stringify(request)).not.toMatch(/dirty|localVersion/);
    expect(snapshot.decks.get(deck.id)).toBe(1);
  });

  it('never exceeds 500 rows, and fills a batch decks-first', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    for (let i = 0; i < 520; i++) await createCard(ctx, deck.id, `f${String(i)}`, 'b');
    const { request } = await buildPushBatch(ctx, 'dev');
    expect(request.decks).toHaveLength(1);
    expect(request.cards).toHaveLength(499);
    expect(request.reviewLogs).toHaveLength(0);
  });

  it('skips rows that are not dirty', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    await ctx.db.decks.update(deck.id, { dirty: 0 });
    const { request } = await buildPushBatch(ctx, 'dev');
    expect(request.decks).toEqual([]);
  });
});

describe('syncOnce (push, then pull)', () => {
  it('pushes every dirty row (several batches if needed) and clears dirty', async () => {
    const server = new FakeServer();
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    for (let i = 0; i < 600; i++) await createCard(ctx, deck.id, `f${String(i)}`, 'b');
    await syncOnce(ctx, fakeTransport(server));
    // 1 deck + 600 cards + 600 card_created events = 1201 rows → 3 batches of ≤500.
    expect(server.pushes.length).toBe(3);
    expect(server.events.size).toBe(600);
    expect(server.cards.size).toBe(600);
    expect(await ctx.db.cards.where('dirty').equals(1).count()).toBe(0);
    expect(await ctx.db.decks.where('dirty').equals(1).count()).toBe(0);
  }, 30_000);

  it('always pushes before pulling', async () => {
    const server = new FakeServer();
    const ctx = await device();
    await createDeck(ctx, 'D');
    await syncOnce(ctx, fakeTransport(server));
    expect(server.calls).toEqual(['push', 'pull']);
  });

  it('an edit made while a push is in flight is not lost (localVersion rule)', async () => {
    const server = new FakeServer();
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'original', 'b');
    const transport = fakeTransport(server, {
      duringPush: async () => {
        ctx.advance(MINUTE);
        await updateCard(ctx, card.id, { front: 'edited mid-push', back: 'b' });
      },
    });
    await syncOnce(ctx, transport);
    // The pushed version was the original; the edit stays dirty for the next sync.
    expect(server.cards.get(card.id)?.row.front).toBe('original');
    expect((await ctx.db.cards.get(card.id))?.dirty).toBe(1);
    expect((await ctx.db.cards.get(card.id))?.front).toBe('edited mid-push');

    transport.options.duringPush = undefined;
    await syncOnce(ctx, transport);
    expect(server.cards.get(card.id)?.row.front).toBe('edited mid-push');
    expect((await ctx.db.cards.get(card.id))?.dirty).toBe(0);
  });

  it('applies pulled rows, replays affected cards and saves the cursor', async () => {
    const server = new FakeServer();
    const a = await device();
    const deck = await createDeck(a, 'Shared');
    const card = await createCard(a, deck.id, 'q', 'a');
    a.advance(MINUTE);
    await rateCard(a, { cardId: card.id, rating: 4, durationMs: 1 });
    await syncOnce(a, fakeTransport(server));

    const b = await device();
    await syncOnce(b, fakeTransport(server));
    expect((await b.db.decks.get(deck.id))?.name).toBe('Shared');
    expect((await b.db.cards.get(card.id))?.dirty).toBe(0);
    const logs = await b.db.reviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(await b.db.cardStates.get(card.id)).toEqual(
      replay((await b.db.cards.get(card.id)) ?? card, logs),
    );
    const lastSeq = Math.max(
      ...[
        ...server.decks.values(),
        ...server.cards.values(),
        ...server.logs.values(),
        ...server.events.values(),
      ].map((v) => v.seq),
    );
    expect(await getMeta(b.db, 'syncCursor')).toBe(String(lastSeq));
  });

  it('pages through the pull until hasMore is false', async () => {
    const server = new FakeServer();
    const a = await device();
    const deck = await createDeck(a, 'D');
    for (let i = 0; i < 30; i++) await createCard(a, deck.id, `f${String(i)}`, 'b');
    await syncOnce(a, fakeTransport(server));
    const b = await device();
    await syncOnce(b, fakeTransport(server), { pullLimit: 7 });
    expect(await b.db.cards.count()).toBe(30);
    expect(server.calls.filter((c) => c === 'pull').length).toBeGreaterThanOrEqual(5);
  });

  it('pulled rows merge with local ones: LWW for cards, sticky tombstones, undo for logs', async () => {
    const server = new FakeServer();
    const a = await device();
    const deck = await createDeck(a, 'D');
    const keep = await createCard(a, deck.id, 'keep', 'b');
    const gone = await createCard(a, deck.id, 'gone', 'b');
    await rateCard(a, { cardId: keep.id, rating: 3, durationMs: 1 });
    await syncOnce(a, fakeTransport(server));

    const b = await device(T0 + 5 * MINUTE);
    await syncOnce(b, fakeTransport(server));
    // A: newer edit to `keep`, deletes `gone`, undoes its review. B: an older edit to `keep`.
    a.setNow(T0 + 10 * MINUTE);
    await updateCard(a, keep.id, { front: 'keep v2', back: 'b' });
    await deleteCard(a, gone.id);
    await undoLastReview(a, T0);
    b.setNow(T0 + 6 * MINUTE);
    await updateCard(b, gone.id, { front: 'edited on B', back: 'b' });
    await syncOnce(a, fakeTransport(server));
    await syncOnce(b, fakeTransport(server));
    await syncOnce(a, fakeTransport(server));

    for (const ctx of [a, b]) {
      expect((await ctx.db.cards.get(keep.id))?.front).toBe('keep v2');
      expect((await ctx.db.cards.get(gone.id))?.deletedAt).not.toBeNull();
      expect((await ctx.db.reviewLogs.toArray())[0]?.voidedAt).not.toBeNull();
      expect((await ctx.db.cardStates.get(keep.id))?.state).toBe('new');
    }
  });
});

describe('SyncEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function signedInDevice() {
    const ctx = await device();
    await createDeck(ctx, 'Something to push');
    const server = new FakeServer();
    const transport = fakeTransport(server);
    const engine = new SyncEngine({ ctx, transport, isOnline: () => true });
    await engine.signedIn({ id: 'u1', email: 'a@example.com' });
    return { ctx, server, transport, engine };
  }

  it('is "signed out" and makes no calls until someone signs in', async () => {
    const ctx = await device();
    const server = new FakeServer();
    const engine = new SyncEngine({ ctx, transport: fakeTransport(server), isOnline: () => true });
    await engine.start();
    expect(engine.getStatus()).toEqual({ kind: 'signedOut' });
    expect(server.calls).toEqual([]);
  });

  it('signing in stores the account and syncs; status becomes "synced"', async () => {
    const { ctx, server, engine } = await signedInDevice();
    expect(await getMeta(ctx.db, 'auth')).toEqual({ signedIn: true, email: 'a@example.com' });
    expect(server.calls).toEqual(['push', 'pull']);
    expect(engine.getStatus()).toEqual({ kind: 'synced', at: ctx.now() });
  });

  it('runs one sync at a time; a request during a sync runs one more afterwards', async () => {
    const { ctx, server, transport, engine } = await signedInDevice();
    server.calls.length = 0;
    let release: () => void = () => undefined;
    transport.options.duringPush = () =>
      new Promise<void>((r) => {
        release = r;
      });
    await createDeck(ctx, 'D1');
    const first = engine.requestSync();
    const second = engine.requestSync();
    const third = engine.requestSync();
    expect(engine.getStatus()).toEqual({ kind: 'syncing' });
    transport.options.duringPush = undefined;
    release();
    await Promise.all([first, second, third]);
    // The running sync, plus exactly one follow-up for the requests made meanwhile.
    expect(server.calls.filter((c) => c === 'pull')).toHaveLength(2);
  });

  it('on failure: "Couldn’t sync · retrying" with backoff 5s, 10s, 20s… up to 5 min', async () => {
    const { transport, engine } = await signedInDevice();
    transport.options.fail = 'network';
    await engine.requestSync();
    expect(engine.getStatus()).toEqual({ kind: 'error' });
    expect(engine.nextRetryDelay()).toBe(5_000);
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      delays.push(engine.nextRetryDelay() ?? -1);
      await vi.advanceTimersByTimeAsync(engine.nextRetryDelay() ?? 0);
      await engine.idle(); // the retry that timer started
    }
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    transport.options.fail = null;
    await vi.advanceTimersByTimeAsync(300_000);
    await engine.idle();
    expect(engine.getStatus().kind).toBe('synced');
    expect(engine.nextRetryDelay()).toBeNull();
  });

  it('shows "offline" when the browser is offline', async () => {
    const ctx = await device();
    const server = new FakeServer();
    const transport = fakeTransport(server);
    let online = true;
    const engine = new SyncEngine({ ctx, transport, isOnline: () => online });
    await engine.signedIn({ id: 'u1', email: 'a@example.com' });
    online = false;
    transport.options.fail = 'network';
    await engine.requestSync();
    expect(engine.getStatus()).toEqual({ kind: 'offline' });
  });

  it('a 401 means the session ended: signed out locally, data kept, studying unaffected', async () => {
    const { ctx, transport, engine } = await signedInDevice();
    const deck = await createDeck(ctx, 'Local');
    transport.options.fail = 'auth';
    await engine.requestSync();
    expect(engine.getStatus()).toEqual({ kind: 'signedOut' });
    expect(await getMeta(ctx.db, 'auth')).toEqual({ signedIn: false, email: null });
    expect((await ctx.db.decks.get(deck.id))?.dirty).toBe(1);
  });

  it('start() checks the session with /me and syncs when signed in', async () => {
    const ctx = await device();
    const server = new FakeServer();
    const engine = new SyncEngine({ ctx, transport: fakeTransport(server), isOnline: () => true });
    await engine.refreshAuth();
    expect(await getMeta(ctx.db, 'auth')).toEqual({ signedIn: true, email: 'a@example.com' });
    expect(engine.getStatus().kind).toBe('synced');
  });

  it('signOut forgets the account but keeps local data', async () => {
    const { ctx, engine } = await signedInDevice();
    const deck = await createDeck(ctx, 'Mine');
    await engine.signOut();
    expect(engine.getStatus()).toEqual({ kind: 'signedOut' });
    expect(await getMeta(ctx.db, 'auth')).toEqual({ signedIn: false, email: null });
    expect(await ctx.db.decks.get(deck.id)).toBeDefined();
  });

  it('notifies subscribers of status changes', async () => {
    const { engine, ctx } = await signedInDevice();
    const seen: string[] = [];
    engine.subscribe((s) => seen.push(s.kind));
    await createDeck(ctx, 'D');
    await engine.requestSync();
    expect(seen).toEqual(['syncing', 'synced']);
  });
});

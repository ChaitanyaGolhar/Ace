import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { RecallDB } from '../src/db/db';
import { initialize } from '../src/services/bootstrap';
import { createCard } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import { recordEvent } from '../src/services/events';
import { validateDeckFile } from '@recall/core';
import { createCatalogDeck } from '../src/services/catalog';
import { rateCard, undoLastReview } from '../src/services/review';
import { finishSession, startSession } from '../src/services/session';
import { SyncEngine } from '../src/sync/engine';
import { syncOnce } from '../src/sync/syncOnce';
import { FakeServer, fakeTransport } from './fakeServer';
import { makeTestContext, MINUTE, T0, type TestContext } from './helpers';

async function device(start = T0) {
  const ctx = makeTestContext(start);
  await initialize(ctx, { requestPersist: undefined });
  return ctx;
}

const typesOf = async (ctx: TestContext) =>
  (await ctx.db.events.orderBy('occurredAt').toArray()).map((e) => e.type);

describe('recordEvent', () => {
  it('stores a dirty, validated event with this device’s id', async () => {
    const ctx = await device();
    await recordEvent(ctx, 'app_opened', {});
    const [event] = await ctx.db.events.toArray();
    expect(event).toMatchObject({
      type: 'app_opened',
      props: {},
      occurredAt: T0,
      dirty: 1,
      localVersion: 1,
    });
    expect(event?.deviceId).toBeTruthy();
  });

  it('refuses a payload with card text (the schema is strict)', async () => {
    const ctx = await device();
    await expect(
      recordEvent(ctx, 'card_created', { front: 'What is ACID?' } as never),
    ).rejects.toThrow();
    expect(await ctx.db.events.count()).toBe(0);
  });
});

describe('where events are recorded', () => {
  it('card_created when a card is created (no text in the event)', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    await createCard(ctx, deck.id, 'secret question', 'secret answer');
    expect(await typesOf(ctx)).toEqual(['card_created']);
    expect(JSON.stringify(await ctx.db.events.toArray())).not.toMatch(/secret/);
  });

  it('catalog_deck_added with the slug and version (and no card_created per copied card)', async () => {
    const ctx = await device();
    const file = validateDeckFile({
      format: 'ace-deck@2',
      slug: 'sample',
      version: 3,
      title: 'S',
      description: 'd',
      catalog: {
        university: 'SPPU',
        pattern: '2024',
        year: 'TE',
        semester: 5,
        branches: ['CSE'],
        subject: 'S',
        subjectCodes: { CSE: null },
        units: [{ number: 1, title: 'One' }],
      },
      price: 0,
      author: 'A',
      lastVerifiedAt: '2026-10-11',
      cards: [
        { key: 'u1-001', unit: 1, type: 'basic', front: 'q1', back: 'a1' },
        { key: 'u1-002', unit: 1, type: 'basic', front: 'q2', back: 'a2' },
      ],
    });
    if (!file.ok) throw new Error(file.errors.join(' '));
    await createCatalogDeck(ctx, file.deck);
    const events = await ctx.db.events.toArray();
    expect(events.map((e) => [e.type, e.props])).toEqual([
      ['catalog_deck_added', { slug: 'sample', version: 3 }],
    ]);
  });

  it('first_review_completed only once, on the device’s first review ever', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const a = await createCard(ctx, deck.id, 'a', 'a');
    const b = await createCard(ctx, deck.id, 'b', 'b');
    await rateCard(ctx, { cardId: a.id, rating: 3, durationMs: 1 });
    ctx.advance(MINUTE);
    await undoLastReview(ctx, T0);
    await rateCard(ctx, { cardId: b.id, rating: 3, durationMs: 1 });
    const firsts = (await ctx.db.events.toArray()).filter(
      (e) => e.type === 'first_review_completed',
    );
    expect(firsts).toHaveLength(1);
  });

  it('session_started (with due/new counts) only when a new session starts', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    await createCard(ctx, deck.id, 'a', 'a');
    await createCard(ctx, deck.id, 'b', 'b');
    await startSession(ctx, null, 'UTC');
    ctx.advance(MINUTE);
    await startSession(ctx, null, 'UTC'); // continued after a reload: no new event
    const started = (await ctx.db.events.toArray()).filter((e) => e.type === 'session_started');
    expect(started.map((e) => e.props)).toEqual([{ scope: 'all', due: 0, new: 2 }]);
  });

  it('finishing with cards left is session_abandoned; with none left, session_completed', async () => {
    const ctx = await device();
    await startSession(ctx, null, 'UTC');
    await finishSession(ctx, { reviewed: 2, remaining: 3, timeSpentMs: 9000 });
    await finishSession(ctx, { reviewed: 2, remaining: 3, timeSpentMs: 9000 }); // once only
    ctx.advance(MINUTE);
    await startSession(ctx, null, 'UTC');
    await finishSession(ctx, { reviewed: 4, remaining: 0, timeSpentMs: 60_000 });
    const ends = (await ctx.db.events.orderBy('occurredAt').toArray())
      .filter((e) => e.type === 'session_abandoned' || e.type === 'session_completed')
      .map((e) => [e.type, e.props]);
    expect(ends).toEqual([
      ['session_abandoned', { reviewed: 2, remaining: 3 }],
      ['session_completed', { reviewed: 4, durationMs: 60_000 }],
    ]);
  });

  it('leaving an empty session (nothing studied, nothing left) records neither', async () => {
    const ctx = await device();
    await startSession(ctx, null, 'UTC');
    await finishSession(ctx, { reviewed: 0, remaining: 0, timeSpentMs: 0 });
    const types = await typesOf(ctx);
    expect(types).not.toContain('session_completed');
    expect(types).not.toContain('session_abandoned');
  });

  it('signed_in when an account signs in on this device', async () => {
    const ctx = await device();
    const engine = new SyncEngine({
      ctx,
      transport: fakeTransport(new FakeServer()),
      isOnline: () => true,
    });
    await engine.signedIn({ id: 'u1', email: 'a@example.com' });
    await engine.signedIn({ id: 'u1', email: 'a@example.com' }); // already signed in: no repeat
    expect((await typesOf(ctx)).filter((t) => t === 'signed_in')).toHaveLength(1);
  });
});

describe('events sync like review logs', () => {
  it('recorded offline, synced later, without duplicates on the server or other devices', async () => {
    const server = new FakeServer();
    const a = await device();
    const transport = fakeTransport(server, { fail: 'network' });
    await recordEvent(a, 'app_opened', {});
    const deck = await createDeck(a, 'D');
    await createCard(a, deck.id, 'q', 'a');
    await expect(syncOnce(a, transport)).rejects.toThrow(); // offline
    expect(await a.db.events.where('dirty').equals(1).count()).toBe(2);

    transport.options.fail = null;
    await syncOnce(a, transport);
    await syncOnce(a, transport); // a second sync sends nothing new
    expect(server.events.size).toBe(2);
    expect(await a.db.events.where('dirty').equals(1).count()).toBe(0);

    const b = await device();
    await syncOnce(b, fakeTransport(server));
    await syncOnce(b, fakeTransport(server));
    expect((await b.db.events.toArray()).map((e) => e.type).sort()).toEqual([
      'app_opened',
      'card_created',
    ]);
    // Pulled events never go back up.
    expect(await b.db.events.where('dirty').equals(1).count()).toBe(0);
  });
});

describe('local database upgrade', () => {
  it('a version-1 database (before events) opens at the current version with its data intact', async () => {
    const name = 'upgrade-v1-to-v2';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      decks: 'id, updatedAt, deletedAt, dirty',
      cards: 'id, deckId, updatedAt, deletedAt, dirty',
      reviewLogs: 'id, cardId, reviewedAt, dirty',
      cardStates: 'cardId, due, state',
      meta: 'key',
    });
    await v1.table('meta').put({ key: 'deviceId', value: 'old-device' });
    await v1.table('decks').put({ id: 'd1', name: 'Kept', dirty: 1 });
    v1.close();

    const db = new RecallDB(name);
    await db.open();
    expect(db.verno).toBe(4); // v1 → v2 (events) → v3 (M6 typed cards) → v4 (M7 catalog)
    expect(await db.decks.get('d1')).toMatchObject({ name: 'Kept' });
    expect(await db.meta.get('deviceId')).toEqual({ key: 'deviceId', value: 'old-device' });
    expect(await db.events.count()).toBe(0);
    db.close();
  });
});

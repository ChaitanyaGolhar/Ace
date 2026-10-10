import Dexie from 'dexie';
import { cardFields, PROTOCOL_VERSION, type Card, type CardContent } from '@recall/core';
import { describe, expect, it } from 'vitest';
import { RecallDB } from '../src/db/db';
import { getMeta, setMeta } from '../src/db/meta';
import { exportBackup, importBackup } from '../src/services/backup';
import { initialize } from '../src/services/bootstrap';
import { createCard, createTypedCard, updateCardContent } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import { UserInputError } from '../src/services/errors';
import { rateCard } from '../src/services/review';
import { syncStatusView } from '../src/services/syncStatus';
import { SyncEngine } from '../src/sync/engine';
import { applyPullPage, buildPushBatch, syncOnce } from '../src/sync/syncOnce';
import { FakeServer, fakeTransport } from './fakeServer';
import { DAY, makeTestContext, MINUTE, T0 } from './helpers';

// M6 data layer (BUILD_BRIEF_M6_M8 §6.2–6.6): typed cards, outcomes, the local database
// upgrade, sync protocol v2 and old-server/old-client protection.

const contents: CardContent[] = [
  { type: 'basic', front: 'What is 2NF?', back: 'No partial dependency' },
  {
    type: 'mcq',
    question: 'Which key identifies a row?',
    options: [
      { id: 'a', text: 'Foreign key' },
      { id: 'b', text: 'Primary key' },
    ],
    correct: 'b',
    explanation: null,
  },
  {
    type: 'cloze',
    text: 'A {{primary key}} identifies a row.',
    accepted: ['pk'],
    hint: null,
    extra: null,
  },
  {
    type: 'short',
    question: 'What is a view?',
    answer: 'A stored query.',
    explanation: 'Virtual.',
  },
  {
    type: 'long',
    question: 'Explain ACID.',
    marks: 6,
    keyPoints: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
    modelAnswer: null,
  },
];
const [, mcq, cloze, , long] = contents as [
  CardContent,
  CardContent,
  CardContent,
  CardContent,
  CardContent,
];

async function device() {
  const ctx = makeTestContext();
  await initialize(ctx, { requestPersist: undefined });
  return ctx;
}

describe('creating and editing typed cards', () => {
  it('stores every type with its derived front/back, dirty and with a fresh CardState', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    for (const content of contents) {
      const card = await createTypedCard(ctx, deck.id, content);
      expect(card).toMatchObject({ ...cardFields(content), dirty: 1, unit: null });
      expect(await ctx.db.cardStates.get(card.id)).toMatchObject({ state: 'new' });
    }
  });

  it('trims text, turns blank optional fields into null, and drops blank accepted spellings', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createTypedCard(ctx, deck.id, {
      type: 'cloze',
      text: '  A {{key}} here.  ',
      accepted: ['  k ', '', '   '],
      hint: '  ',
      extra: ' Note ',
    });
    expect(card.content).toEqual({
      type: 'cloze',
      text: 'A {{key}} here.',
      accepted: ['k'],
      hint: null,
      extra: 'Note',
    });
  });

  it('rejects invalid content with the field and a readable message, storing nothing', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const bad = { ...(mcq as Extract<CardContent, { type: 'mcq' }>), correct: 'e' as const };
    const error = await createTypedCard(ctx, deck.id, bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserInputError);
    expect(error).toMatchObject({ field: 'correct' });
    expect(await ctx.db.cards.count()).toBe(0);
  });

  it('the basic-card helper still works as before', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, ' Q ', ' A ');
    expect(card).toMatchObject({
      type: 'basic',
      content: { type: 'basic', front: 'Q', back: 'A' },
    });
  });

  it('editing keeps the id and the schedule, can change the type, and marks the card dirty', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'Q', 'A');
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1000 });
    const scheduled = await ctx.db.cardStates.get(card.id);
    ctx.advance(MINUTE);

    await updateCardContent(ctx, card.id, long);
    const edited = await ctx.db.cards.get(card.id);
    expect(edited).toMatchObject({
      id: card.id,
      ...cardFields(long),
      updatedAt: T0 + MINUTE,
      dirty: 1,
    });
    expect(edited?.localVersion).toBe(card.localVersion + 1);
    expect(await ctx.db.cardStates.get(card.id)).toEqual(scheduled);
  });

  it('an edit that changes nothing writes nothing', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createTypedCard(ctx, deck.id, long);
    await updateCardContent(ctx, card.id, structuredClone(long));
    expect((await ctx.db.cards.get(card.id))?.localVersion).toBe(card.localVersion);
  });
});

describe('ratings with outcomes', () => {
  it('stores the outcome on the log', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createTypedCard(ctx, deck.id, mcq);
    const { log } = await rateCard(ctx, {
      cardId: card.id,
      rating: 1,
      durationMs: 900,
      outcome: { kind: 'mcq', selected: 'a', correct: false },
    });
    expect(log.outcome).toEqual({ kind: 'mcq', selected: 'a', correct: false });
  });

  it('refuses a rating the outcome doesn’t allow (mcq wrong → Again only), storing nothing', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createTypedCard(ctx, deck.id, mcq);
    await expect(
      rateCard(ctx, {
        cardId: card.id,
        rating: 3,
        durationMs: 900,
        outcome: { kind: 'mcq', selected: 'a', correct: false },
      }),
    ).rejects.toThrow();
    expect(await ctx.db.reviewLogs.count()).toBe(0);
  });

  it('refuses an outcome of the wrong kind for the card', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createTypedCard(ctx, deck.id, cloze);
    await expect(
      rateCard(ctx, {
        cardId: card.id,
        rating: 3,
        durationMs: 900,
        outcome: { kind: 'mcq', selected: 'b', correct: true },
      }),
    ).rejects.toThrow(/outcome/);
  });
});

describe('local database upgrade to version 3', () => {
  it('turns existing cards into basic cards with identical text; logs, states and flags unchanged; re-pull scheduled', async () => {
    const name = 'upgrade-v2-to-v3';
    const v2 = new Dexie(name);
    v2.version(1).stores({
      decks: 'id, updatedAt, deletedAt, dirty',
      cards: 'id, deckId, updatedAt, deletedAt, dirty',
      reviewLogs: 'id, cardId, reviewedAt, dirty',
      cardStates: 'cardId, due, state',
      meta: 'key',
    });
    v2.version(2).stores({ events: 'id, type, occurredAt, dirty' });
    const legacyCard = {
      id: '01920000-0000-7000-8000-000000000101',
      deckId: '01920000-0000-7000-8000-000000000001',
      front: 'Which is true?\nA. one\nB. two',
      back: '• B',
      createdAt: T0,
      updatedAt: T0 + 1,
      deletedAt: null,
      dirty: 1,
      localVersion: 3,
    };
    const legacyLog = {
      id: '01920000-0000-7000-8000-000000001001',
      cardId: legacyCard.id,
      rating: 3,
      reviewedAt: T0 + DAY,
      durationMs: 4000,
      deviceId: 'old',
      voidedAt: null,
      dirty: 0,
      localVersion: 1,
    };
    const state = { cardId: legacyCard.id, due: T0 + 3 * DAY, state: 'review', stability: 3 };
    await v2.table('cards').put(legacyCard);
    await v2.table('reviewLogs').put(legacyLog);
    await v2.table('cardStates').put(state);
    await v2.table('meta').put({ key: 'syncCursor', value: '1234' });
    v2.close();

    const db = new RecallDB(name);
    await db.open();
    expect(db.verno).toBe(3);
    const card = await db.cards.get(legacyCard.id);
    expect(card).toEqual({
      ...legacyCard,
      type: 'basic',
      content: { type: 'basic', front: legacyCard.front, back: legacyCard.back },
      unit: null,
      sourceKey: null,
      sourceHash: null,
    });
    expect(await db.reviewLogs.get(legacyLog.id)).toEqual({ ...legacyLog, outcome: null });
    expect(await db.cardStates.get(legacyCard.id)).toEqual(state);
    // Rows an old client pulled had their new fields stripped: pull everything once more.
    expect(await getMeta(db, 'syncCursor')).toBe('0');
    db.close();
  });
});

describe('sync with typed cards', () => {
  it('pushes carry protocolVersion 2', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    await createTypedCard(ctx, deck.id, mcq);
    const { request } = await buildPushBatch(ctx, 'dev');
    expect(request.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('every type and outcome syncs from one device to another unchanged', async () => {
    const server = new FakeServer();
    const a = await device();
    const deck = await createDeck(a, 'D');
    const cards: Card[] = [];
    for (const content of contents) cards.push(await createTypedCard(a, deck.id, content));
    await rateCard(a, {
      cardId: cards[2]?.id ?? '',
      rating: 1,
      durationMs: 1,
      outcome: { kind: 'cloze', mode: 'typed', correct: false },
    });
    await syncOnce(a, fakeTransport(server));

    const b = await device();
    await syncOnce(b, fakeTransport(server));
    for (const card of cards) {
      const copy = await b.db.cards.get(card.id);
      expect(copy).toMatchObject({ type: card.type, content: card.content, front: card.front });
    }
    const [log] = await b.db.reviewLogs.toArray();
    expect(log?.outcome).toEqual({ kind: 'cloze', mode: 'typed', correct: false });
  });

  it('a pull replaces a clean local copy that an old client had stripped (no local changes to lose)', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const typed = await createTypedCard(ctx, deck.id, mcq);
    // What an old client left behind after pulling this card: a "basic" copy, clean.
    const stripped = {
      ...typed,
      ...cardFields({ type: 'basic', front: typed.front, back: typed.back }),
      dirty: 0 as const,
    };
    await ctx.db.cards.put(stripped);

    const { dirty: _d, localVersion: _v, ...server } = typed;
    await applyPullPage(ctx, {
      decks: [],
      cards: [server],
      reviewLogs: [],
      events: [],
      nextCursor: '9',
      hasMore: false,
    });
    expect(await ctx.db.cards.get(typed.id)).toMatchObject({ type: 'mcq', content: mcq, dirty: 0 });
  });

  it('a dirty local copy still merges by last-write-wins (a newer local edit survives)', async () => {
    const ctx = await device();
    const deck = await createDeck(ctx, 'D');
    const card = await createTypedCard(ctx, deck.id, mcq);
    ctx.advance(MINUTE);
    await updateCardContent(ctx, card.id, long);
    const { dirty: _d, localVersion: _v, ...older } = card;
    await applyPullPage(ctx, {
      decks: [],
      cards: [older],
      reviewLogs: [],
      events: [],
      nextCursor: '9',
      hasMore: false,
    });
    expect(await ctx.db.cards.get(card.id)).toMatchObject({ type: 'long', dirty: 1 });
  });
});

describe('426: this app is older than the server', () => {
  it('stops syncing with "Update required to sync", without retrying in a loop; local data untouched', async () => {
    const server = new FakeServer();
    const ctx = await device();
    const transport = fakeTransport(server, { fail: 'upgrade' });
    const engine = new SyncEngine({ ctx, transport, isOnline: () => true });
    await setMeta(ctx.db, 'auth', { signedIn: true, email: 'a@example.com' });
    const deck = await createDeck(ctx, 'D');
    await createTypedCard(ctx, deck.id, long);

    await engine.start();
    await engine.idle();
    expect(engine.getStatus()).toEqual({ kind: 'updateRequired' });
    expect(engine.nextRetryDelay()).toBeNull();

    const calls = server.calls.length;
    await engine.requestSync(); // triggers (online, interval, Sync now) do nothing now
    await engine.idle();
    expect(server.calls.length).toBe(calls);
    expect(await ctx.db.cards.where('dirty').equals(1).count()).toBe(1);
  });

  it('the status reads "Update required to sync"', () => {
    expect(syncStatusView({ kind: 'updateRequired' }, T0)).toMatchObject({
      icon: 'error',
      text: 'Update required to sync',
    });
  });
});

describe('backup round-trips every type', () => {
  it('export → import into a fresh device gives identical cards, logs (with outcomes) and states', async () => {
    const a = await device();
    const deck = await createDeck(a, 'D');
    for (const content of contents) await createTypedCard(a, deck.id, content);
    const longCard = (await a.db.cards.toArray()).find((c) => c.type === 'long');
    await rateCard(a, {
      cardId: longCard?.id ?? '',
      rating: 2,
      durationMs: 1,
      outcome: { kind: 'long', hit: 2, total: 4, suggested: 2 },
    });
    const backup = await exportBackup(a);
    expect(backup.version).toBe(2);

    const b = await device();
    await importBackup(b, JSON.parse(JSON.stringify(backup)));
    const strip = <T extends { dirty: number; localVersion: number }>(rows: T[]) =>
      rows
        .map(({ dirty: _d, localVersion: _v, ...rest }) => rest)
        .sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
    expect(strip(await b.db.cards.toArray())).toEqual(strip(await a.db.cards.toArray()));
    expect(strip(await b.db.reviewLogs.toArray())).toEqual(strip(await a.db.reviewLogs.toArray()));
    const states = async (ctx: typeof a) =>
      (await ctx.db.cardStates.toArray()).sort((x, y) => (x.cardId < y.cardId ? -1 : 1));
    expect(await states(b)).toEqual(await states(a));
  });
});

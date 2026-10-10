import { prepareDatabase, startTestServer, type TestServer } from '@recall/api/testing';
import { replay, type CardContent } from '@recall/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initialize } from '../../src/services/bootstrap';
import {
  createCard,
  createTypedCard,
  updateCard,
  updateCardContent,
} from '../../src/services/cards';
import { createDeck } from '../../src/services/decks';
import { recordEvent } from '../../src/services/events';
import { rateCard } from '../../src/services/review';
import { SyncEngine } from '../../src/sync/engine';
import { syncOnce } from '../../src/sync/syncOnce';
import { httpTransport, UpgradeRequiredError, type SyncTransport } from '../../src/sync/transport';
import { DAY, makeTestContext, MINUTE, T0, type TestContext } from '../helpers';

// The web sync engine against the REAL API and a real Postgres (brief §12, M2):
// two Dexie databases (fake-indexeddb) play two devices of the same user.

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://recall:recall@localhost:54329/postgres';

let server: TestServer;

beforeAll(async () => {
  const dbUrl = await prepareDatabase(ADMIN_URL, 'recall_web_test');
  // Server clock well after the test clock, so no timestamp is clamped as "future".
  server = await startTestServer(dbUrl, { now: () => T0 + 365 * DAY });
}, 60_000);

afterAll(async () => {
  await server.close();
});

let emailCounter = 0;
let email = '';
beforeEach(() => {
  emailCounter += 1;
  email = `user${String(emailCounter)}-${String(Date.now())}@example.com`;
});

/** Signs in through the real magic-link flow; returns a fetch that sends the cookie. */
async function signedInFetch(address: string): Promise<typeof fetch> {
  await fetch(`${server.url}/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: address }),
  });
  const link = server.mailer.sent.filter((m) => m.email === address).at(-1)?.link;
  if (!link) throw new Error('no magic link');
  const verify = await fetch(link, { redirect: 'manual' });
  const cookie = verify.headers.getSetCookie().find((c) => c.startsWith('recall_session='));
  if (!cookie) throw new Error('no session cookie');
  const value = cookie.split(';')[0] ?? '';
  return (input, init) =>
    fetch(input, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), Cookie: value },
    });
}

async function newDevice(start = T0): Promise<TestContext> {
  const ctx = makeTestContext(start);
  // Distinct ids per device (makeTestContext restarts its counter for every context),
  // set before initialize() so each device also gets its own deviceId.
  const prefix = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  let n = 0;
  ctx.newId = () => `${prefix}-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;
  await initialize(ctx, { requestPersist: undefined });
  return ctx;
}

async function transportFor(address: string): Promise<SyncTransport> {
  return httpTransport(server.url, await signedInFetch(address));
}

describe('two clients against the real API', () => {
  it('both study the same card offline, then sync: identical logs and CardState', async () => {
    const a = await newDevice();
    const b = await newDevice();
    const ta = await transportFor(email);
    const tb = await transportFor(email);

    const deck = await createDeck(a, 'Shared');
    const card = await createCard(a, deck.id, 'What is ACID?', 'Atomicity…');
    await syncOnce(a, ta);
    await syncOnce(b, tb);
    expect((await b.db.cards.get(card.id))?.front).toBe('What is ACID?');

    // Offline, both study the same card.
    a.setNow(T0 + DAY);
    await rateCard(a, { cardId: card.id, rating: 3, durationMs: 4000 });
    b.setNow(T0 + DAY + 10 * MINUTE);
    await rateCard(b, { cardId: card.id, rating: 1, durationMs: 6000 });

    // Back online, in any order.
    await syncOnce(a, ta);
    await syncOnce(b, tb);
    await syncOnce(a, ta);

    const logsA = (await a.db.reviewLogs.toArray()).map(
      ({ dirty: _d, localVersion: _v, ...l }) => l,
    );
    const logsB = (await b.db.reviewLogs.toArray()).map(
      ({ dirty: _d, localVersion: _v, ...l }) => l,
    );
    const byId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : 1);
    expect(logsA).toHaveLength(2);
    expect(logsA.sort(byId)).toEqual(logsB.sort(byId));
    expect(new Set(logsA.map((l) => l.deviceId)).size).toBe(2); // two real devices
    const stateA = await a.db.cardStates.get(card.id);
    const stateB = await b.db.cardStates.get(card.id);
    expect(stateA).toEqual(stateB);
    expect(stateA).toEqual(replay(card, logsA));
  });

  it('an edit made while a push is in flight is not lost', async () => {
    const a = await newDevice();
    const b = await newDevice();
    const tb = await transportFor(email);
    const authed = await signedInFetch(email);
    const deck = await createDeck(a, 'D');
    const card = await createCard(a, deck.id, 'original', 'answer');

    // Edit the card after the push body was built, before the request reaches the API.
    let editDuringPush = true;
    const ta = httpTransport(server.url, async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (editDuringPush && url.endsWith('/sync/push')) {
        editDuringPush = false;
        a.advance(MINUTE);
        await updateCard(a, card.id, { front: 'edited mid-push', back: 'answer' });
      }
      return authed(input, init);
    });

    await syncOnce(a, ta);
    expect((await a.db.cards.get(card.id))?.dirty).toBe(1); // still to be pushed
    await syncOnce(a, ta);
    expect((await a.db.cards.get(card.id))?.dirty).toBe(0);

    await syncOnce(b, tb);
    expect((await b.db.cards.get(card.id))?.front).toBe('edited mid-push');
  });

  it('anonymous local data is uploaded on first sign-in, then merged with another device', async () => {
    // Device A is already signed in and synced.
    const a = await newDevice();
    const ta = await transportFor(email);
    const deckA = await createDeck(a, 'From A');
    await createCard(a, deckA.id, 'qa', 'aa');
    await syncOnce(a, ta);

    // Device B was used anonymously first: a deck, cards and reviews, all local.
    const b = await newDevice();
    const deckB = await createDeck(b, 'From B (anonymous)');
    const cardB = await createCard(b, deckB.id, 'qb', 'ab');
    b.advance(MINUTE);
    await rateCard(b, { cardId: cardB.id, rating: 4, durationMs: 3000 });

    // B signs in: the engine pushes everything, then pulls A's data. No special merge code.
    const engineB = new SyncEngine({
      ctx: b,
      transport: await transportFor(email),
      isOnline: () => true,
    });
    await engineB.signedIn({ id: 'ignored', email });
    expect(engineB.getStatus().kind).toBe('synced');

    const decksOn = async (ctx: TestContext) =>
      (await ctx.db.decks.toArray()).map((d) => d.name).sort();
    expect(await decksOn(b)).toEqual(['From A', 'From B (anonymous)']);
    await syncOnce(a, ta);
    expect(await decksOn(a)).toEqual(['From A', 'From B (anonymous)']);
    expect(await a.db.reviewLogs.count()).toBe(1);
    expect(await a.db.cardStates.get(cardB.id)).toEqual(await b.db.cardStates.get(cardB.id));
  });

  it('the server enforces the same max lengths as the client', async () => {
    const t = await transportFor(email);
    const id = '01920000-0000-7000-8000-00000000abcd';
    await expect(
      t.push({
        protocolVersion: 2,
        deviceId: 'd',
        decks: [
          {
            id,
            name: 'x'.repeat(201),
            source: 'user',
            prebuiltId: null,
            createdAt: T0,
            updatedAt: T0,
            deletedAt: null,
          },
        ],
        cards: [],
        reviewLogs: [],
        events: [],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('events recorded offline sync later, without duplicates (M4)', async () => {
    const a = await newDevice();
    const b = await newDevice();
    const ta = await transportFor(email);
    const tb = await transportFor(email);
    const offline: SyncTransport = {
      ...ta,
      push: () => Promise.reject(new Error('offline')),
      pull: () => Promise.reject(new Error('offline')),
    };

    await recordEvent(a, 'app_opened', {});
    const deck = await createDeck(a, 'D');
    await createCard(a, deck.id, 'q', 'a');
    await expect(syncOnce(a, offline)).rejects.toThrow();

    await syncOnce(a, ta);
    await syncOnce(a, ta);
    await syncOnce(b, tb);
    await recordEvent(b, 'app_opened', {});
    await syncOnce(b, tb);
    await syncOnce(a, ta);

    const ids = async (ctx: TestContext) => (await ctx.db.events.toArray()).map((e) => e.id).sort();
    expect(await ids(a)).toEqual(await ids(b));
    expect(await ids(a)).toHaveLength(3);
    // A fresh device pulls exactly what the server holds: three events, no duplicates.
    const c = await newDevice();
    await syncOnce(c, await transportFor(email));
    expect(await ids(c)).toEqual(await ids(a));
  });

  it('M6: every card type and review outcome syncs between two devices (studied offline on both)', async () => {
    const a = await newDevice();
    const b = await newDevice();
    const ta = await transportFor(email);
    const tb = await transportFor(email);
    const contents: CardContent[] = [
      { type: 'basic', front: 'Q', back: 'A' },
      {
        type: 'mcq',
        question: 'Pick the primary key',
        options: [
          { id: 'a', text: 'name' },
          { id: 'b', text: 'roll_no' },
        ],
        correct: 'b',
        explanation: 'Unique and not null.',
      },
      {
        type: 'cloze',
        text: 'A {{view}} is a stored query.',
        accepted: [],
        hint: null,
        extra: null,
      },
      {
        type: 'short',
        question: 'Define DBMS.',
        answer: 'Software that manages databases.',
        explanation: null,
      },
      {
        type: 'long',
        question: 'Explain 2PL.',
        marks: 5,
        keyPoints: ['Growing phase', 'Shrinking phase', 'Serializability'],
        modelAnswer: null,
      },
    ];
    const deck = await createDeck(a, 'Typed');
    const ids: string[] = [];
    for (const content of contents) ids.push((await createTypedCard(a, deck.id, content)).id);
    await syncOnce(a, ta);
    await syncOnce(b, tb);

    // Both devices study offline, with outcomes; B also edits the cloze card.
    a.setNow(T0 + DAY);
    b.setNow(T0 + DAY + MINUTE);
    await rateCard(a, {
      cardId: ids[1] ?? '',
      rating: 1,
      durationMs: 1,
      outcome: { kind: 'mcq', selected: 'a', correct: false },
    });
    await rateCard(b, {
      cardId: ids[4] ?? '',
      rating: 2,
      durationMs: 1,
      outcome: { kind: 'long', hit: 2, total: 3, suggested: 2 },
    });
    await rateCard(b, {
      cardId: ids[2] ?? '',
      rating: 4,
      durationMs: 1,
      outcome: { kind: 'cloze', mode: 'typed', correct: true },
    });
    await updateCardContent(b, ids[2] ?? '', {
      type: 'cloze',
      text: 'A {{view}} is a virtual table.',
      accepted: ['views'],
      hint: null,
      extra: null,
    });

    await syncOnce(a, ta);
    await syncOnce(b, tb);
    await syncOnce(a, ta);

    const rows = async (ctx: TestContext) => ({
      cards: (await ctx.db.cards.toArray())
        .map(({ dirty: _d, localVersion: _v, ...c }) => c)
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
      logs: (await ctx.db.reviewLogs.toArray())
        .map(({ dirty: _d, localVersion: _v, ...l }) => l)
        .sort((x, y) => (x.id < y.id ? -1 : 1)),
      states: (await ctx.db.cardStates.toArray()).sort((x, y) => (x.cardId < y.cardId ? -1 : 1)),
    });
    const onA = await rows(a);
    expect(onA).toEqual(await rows(b));
    expect(onA.cards.map((c) => c.type)).toEqual(['basic', 'mcq', 'cloze', 'short', 'long']);
    expect(onA.cards.find((c) => c.type === 'cloze')?.content).toMatchObject({
      accepted: ['views'],
    });
    expect(onA.logs.map((l) => l.outcome?.kind).sort()).toEqual(['cloze', 'long', 'mcq']);
  });

  it('M6: a push without the protocol version (an old app) is refused with 426', async () => {
    const t = await transportFor(email);
    const legacy = {
      deviceId: 'old-phone',
      decks: [],
      cards: [],
      reviewLogs: [],
      events: [],
    } as unknown as Parameters<SyncTransport['push']>[0];
    await expect(t.push(legacy)).rejects.toBeInstanceOf(UpgradeRequiredError);
  });
});

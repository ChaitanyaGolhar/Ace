import { cardFields, type CardContent, type PullResponse } from '@recall/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPrisma, makeTestApp, resetDb, signIn } from './helpers';
import { card, deck, dump, log, pull, push } from './syncFixtures';

// M6 (BUILD_BRIEF_M6_M8 §6.2, §6.4, §6.6): typed cards and review outcomes through
// push/pull, and old clients turned away with 426.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

const contents: CardContent[] = [
  { type: 'basic', front: 'What is 2NF?', back: 'No partial dependency' },
  {
    type: 'mcq',
    question: 'Which key identifies a row?',
    options: [
      { id: 'a', text: 'Foreign key' },
      { id: 'b', text: 'Primary key' },
      { id: 'c', text: 'Candidate key' },
    ],
    correct: 'b',
    explanation: 'It is unique and not null.',
  },
  {
    type: 'cloze',
    text: 'A {{primary key}} identifies a row.',
    accepted: ['pk'],
    hint: 'Two words',
    extra: null,
  },
  { type: 'short', question: 'What is a view?', answer: 'A stored query.', explanation: null },
  {
    type: 'long',
    question: 'Explain ACID.',
    marks: 6,
    keyPoints: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
    modelAnswer: 'ACID describes transactions.',
  },
];

describe('typed cards and outcomes through push/pull', () => {
  it('every type, with unit and source fields, and every outcome kind round-trip exactly', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    const cards = contents.map((content, i) =>
      card(d.id, {
        ...cardFields(content),
        unit: i + 1,
        sourceKey: i === 0 ? null : `u${String(i + 1)}-001`,
        sourceHash: i === 0 ? null : `h${String(i)}`,
      }),
    );
    const [, mcq, cloze, , long] = cards;
    const logs = [
      log(mcq?.id ?? '', { rating: 1, outcome: { kind: 'mcq', selected: 'a', correct: false } }),
      log(cloze?.id ?? '', { rating: 3, outcome: { kind: 'cloze', mode: 'typed', correct: true } }),
      log(cloze?.id ?? '', {
        rating: 2,
        outcome: { kind: 'cloze', mode: 'revealed', correct: null },
      }),
      log(long?.id ?? '', { rating: 4, outcome: { kind: 'long', hit: 2, total: 4, suggested: 2 } }),
    ];
    await push(t, cookie, { decks: [d], cards, reviewLogs: logs }).expect(200);

    const pulled = (await pull(t, cookie)).body as PullResponse;
    expect(pulled.cards).toEqual(cards);
    expect(pulled.reviewLogs).toEqual(logs);
  });

  it('pushing the same content with a different key order changes nothing (jsonb reorders keys)', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    const c = card(d.id, cardFields(contents[1] as CardContent));
    await push(t, cookie, { decks: [d], cards: [c] }).expect(200);
    const before = await dump(t);
    const reordered = { ...c, content: Object.fromEntries(Object.entries(c.content).reverse()) };
    await push(t, cookie, { cards: [reordered as typeof c] }).expect(200);
    expect(await dump(t)).toEqual(before);
  });

  it('rejects a card whose front/back aren’t derived from its content (400), storing nothing', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    const bad = { ...card(d.id, cardFields(contents[1] as CardContent)), front: 'Tampered' };
    const res = await push(t, cookie, { decks: [d], cards: [bad] });
    expect(res.status).toBe(400);
    expect((await dump(t)).cards).toEqual([]);
  });

  it('rejects a log whose rating its outcome doesn’t allow (400)', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    const c = card(d.id, cardFields(contents[1] as CardContent));
    const res = await push(t, cookie, {
      decks: [d],
      cards: [c],
      reviewLogs: [
        log(c.id, { rating: 4, outcome: { kind: 'mcq', selected: 'a', correct: false } }),
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe('old clients (§6.6)', () => {
  it.each([
    ['no protocolVersion', {}],
    ['protocolVersion 1', { protocolVersion: 1 }],
  ])('a push with %s gets 426 and the database is unchanged', async (_label, version) => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    await push(t, cookie, {
      decks: [d],
      cards: [card(d.id, cardFields(contents[2] as CardContent))],
    }).expect(200);
    const before = await dump(t);

    // What a pre-M6 client sends: front/back only, no type/content.
    const legacyCard = {
      id: (before.cards as { id: string }[])[0]?.id,
      deckId: d.id,
      front: 'Overwritten by an old client',
      back: 'x',
      createdAt: d.createdAt,
      updatedAt: d.updatedAt + 1000,
      deletedAt: null,
    };
    const res = await request(t.app)
      .post('/sync/push')
      .set('Cookie', cookie)
      .send({ ...version, deviceId: 'old-phone', decks: [], cards: [legacyCard], reviewLogs: [] });

    expect(res.status).toBe(426);
    expect(res.body).toMatchObject({ error: { code: 'upgrade_required' } });
    expect(await dump(t)).toEqual(before);
  });

  it('a newer protocol version than the server knows is a 400, not a 426', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const res = await request(t.app)
      .post('/sync/push')
      .set('Cookie', cookie)
      .send({ protocolVersion: 3, deviceId: 'd', decks: [], cards: [], reviewLogs: [] });
    expect(res.status).toBe(400);
  });

  it('pulls still work for old clients: every field is included, old ones simply ignore the new ones', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck();
    const c = card(d.id, cardFields(contents[4] as CardContent));
    await push(t, cookie, { decks: [d], cards: [c] }).expect(200);
    const res = await request(t.app).get('/sync/pull').set('Cookie', cookie).query({ since: '0' });
    expect(res.status).toBe(200);
    const [pulled] = (res.body as PullResponse).cards;
    expect(pulled).toMatchObject({ front: 'Explain ACID.', back: c.back, type: 'long' });
  });
});

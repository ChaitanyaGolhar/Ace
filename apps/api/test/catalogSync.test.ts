import { cardFields, catalogCardId, contentHash, type CardContent } from '@recall/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPrisma, makeTestApp, resetDb, signIn } from './helpers';
import { card, deck, log, pull, push } from './syncFixtures';

// M7 (BUILD_BRIEF_M6_M8 §7.5): a student's copy of a catalog deck syncs like any deck,
// with its catalog fields, and its cards' deterministic (v5) ids.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

describe('catalog decks through push/pull', () => {
  it('a catalog deck, its v5-id cards and their review logs round-trip exactly', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck({ source: 'catalog', catalogSlug: 'sppu-te-cse-dbms', catalogVersion: 2 });
    const content: CardContent = { type: 'basic', front: 'What is a DBMS?', back: 'Software.' };
    const c = card(d.id, {
      ...cardFields(content),
      id: catalogCardId(d.id, 'u1-001'),
      unit: 1,
      sourceKey: 'u1-001',
      sourceHash: contentHash(content),
    });
    const l = log(c.id);
    await push(t, cookie, { decks: [d], cards: [c], reviewLogs: [l] }).expect(200);

    const res = await pull(t, cookie).expect(200);
    expect(res.body).toMatchObject({ decks: [d], cards: [c], reviewLogs: [l] });
  });

  it('two devices adding the same card id converge (last write wins, no duplicate)', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const d = deck({ source: 'catalog', catalogSlug: 'sppu-te-cse-dbms', catalogVersion: 1 });
    const content: CardContent = { type: 'basic', front: 'Q', back: 'A' };
    const id = catalogCardId(d.id, 'u1-001');
    const fromA = card(d.id, { ...cardFields(content), id, sourceKey: 'u1-001', updatedAt: 1000 });
    const fromB = card(d.id, { ...cardFields(content), id, sourceKey: 'u1-001', updatedAt: 2000 });
    await push(t, cookie, { decks: [d], cards: [fromA] }).expect(200);
    await push(t, cookie, { cards: [fromB] }).expect(200);
    const res = await pull(t, cookie).expect(200);
    expect((res.body as { cards: unknown[] }).cards).toEqual([fromB]);
  });

  it('a deck can’t claim "catalog" without its slug and version (400)', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const bad = { ...deck(), source: 'catalog' };
    await push(t, cookie, { decks: [bad as never] }).expect(400);
  });
});

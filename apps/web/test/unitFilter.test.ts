import { describe, expect, it } from 'vitest';
import { validateDeckFile, type CardContent } from '@recall/core';
import { initialize } from '../src/services/bootstrap';
import { createCatalogDeck } from '../src/services/catalog';
import { loadQueue } from '../src/services/queue';
import { getSession, startSession } from '../src/services/session';
import { makeTestContext } from './helpers';

// "Study: All units ▾ / Unit 1 / Unit 2 …" (BUILD_BRIEF_M6_M8 §7.7): a study session can
// be scoped to one syllabus unit of a deck, for in-sem revision.

const basic = (front: string): CardContent => ({ type: 'basic', front, back: 'a' });

async function setup() {
  const ctx = makeTestContext();
  await initialize(ctx, { requestPersist: undefined });
  const result = validateDeckFile({
    format: 'ace-deck@2',
    slug: 'dbms',
    version: 1,
    title: 'DBMS',
    description: 'd',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE'],
      subject: 'DBMS',
      subjectCodes: { CSE: null },
      units: [
        { number: 1, title: 'One' },
        { number: 2, title: 'Two' },
      ],
    },
    price: 0,
    author: 'A',
    lastVerifiedAt: '2026-10-11',
    cards: [
      { key: 'u1-001', unit: 1, ...basic('one') },
      { key: 'u2-001', unit: 2, ...basic('two') },
      { key: 'u1-002', unit: 1, ...basic('three') },
    ],
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  const deck = await createCatalogDeck(ctx, result.deck);
  return { ctx, deck };
}

describe('unit filter', () => {
  it('the queue for one unit holds only that unit’s cards', async () => {
    const { ctx, deck } = await setup();
    const all = await loadQueue(ctx, { browserTimeZone: 'UTC', deckId: deck.id });
    const unit1 = await loadQueue(ctx, { browserTimeZone: 'UTC', deckId: deck.id, unit: 1 });
    const unit2 = await loadQueue(ctx, { browserTimeZone: 'UTC', deckId: deck.id, unit: 2 });
    expect(all.newCards).toHaveLength(3);
    expect(unit1.newCards).toHaveLength(2);
    expect(unit2.newCards).toHaveLength(1);
  });

  it('a session remembers its unit; another unit starts a new session', async () => {
    const { ctx, deck } = await setup();
    const s1 = await startSession(ctx, deck.id, 'UTC', 1);
    expect(s1).toMatchObject({ deckId: deck.id, unit: 1 });
    ctx.advance(1000);
    expect(await startSession(ctx, deck.id, 'UTC', 1)).toEqual(s1);
    ctx.advance(1000);
    const s2 = await startSession(ctx, deck.id, 'UTC', 2);
    expect(s2.startedAt).not.toBe(s1.startedAt);
    expect(await getSession(ctx)).toMatchObject({ unit: 2 });
    ctx.advance(1000);
    const all = await startSession(ctx, deck.id, 'UTC');
    expect(all.unit).toBeUndefined();
    expect(all.startedAt).not.toBe(s2.startedAt);
  });

  it('session_started counts only the unit’s cards', async () => {
    const { ctx, deck } = await setup();
    await startSession(ctx, deck.id, 'UTC', 2);
    const [event] = await ctx.db.events.where('type').equals('session_started').toArray();
    expect(event?.props).toEqual({ scope: 'deck', due: 0, new: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { initialize } from '../src/services/bootstrap';
import { createCard, deleteCard } from '../src/services/cards';
import { createDeck, deleteDeck } from '../src/services/decks';
import { loadDeckView, loadHome, loadNextDue, searchCards } from '../src/services/overview';
import { rateCard } from '../src/services/review';
import { updateSettings } from '../src/services/settings';
import { DAY, makeTestContext, MINUTE } from './helpers';

// 2026-10-10 15:30 IST.
const AFTERNOON = Date.parse('2026-10-10T10:00:00Z');
const opts = { browserTimeZone: 'UTC' };

async function setup() {
  const ctx = makeTestContext(AFTERNOON);
  await initialize(ctx, { requestPersist: undefined });
  await updateSettings(ctx, { timeZone: 'Asia/Kolkata', newPerDay: 3 });
  return ctx;
}

describe('loadHome', () => {
  it('is empty for a first-time user', async () => {
    const ctx = await setup();
    expect(await loadHome(ctx, opts)).toEqual({
      counts: { due: 0, new: 0, learning: 0 },
      decks: [],
      tomorrow: 0,
      estimateMinutes: null,
    });
  });

  it('gives total counts and per-deck counts (new cards share the global limit)', async () => {
    const ctx = await setup();
    const a = await createDeck(ctx, 'A');
    const b = await createDeck(ctx, 'B');
    for (let i = 0; i < 2; i++) await createCard(ctx, a.id, `a${String(i)}`, 'x');
    for (let i = 0; i < 4; i++) await createCard(ctx, b.id, `b${String(i)}`, 'x');
    const deleted = await createDeck(ctx, 'Deleted');
    await deleteDeck(ctx, deleted.id);

    const home = await loadHome(ctx, opts);
    expect(home.counts).toEqual({ due: 0, new: 3, learning: 0 });
    expect(home.decks).toEqual([
      {
        id: a.id,
        name: 'A',
        source: 'user',
        cardCount: 2,
        counts: { due: 0, new: 2, learning: 0 },
      },
      {
        id: b.id,
        name: 'B',
        source: 'user',
        cardCount: 4,
        counts: { due: 0, new: 3, learning: 0 },
      },
    ]);
  });

  it('sorts decks by name, case-insensitively', async () => {
    const ctx = await setup();
    await createDeck(ctx, 'beta');
    await createDeck(ctx, 'Alpha');
    expect((await loadHome(ctx, opts)).decks.map((d) => d.name)).toEqual(['Alpha', 'beta']);
  });
});

describe('loadDeckView and searchCards', () => {
  it('lists live cards oldest first, and returns null for a deleted deck', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    const c1 = await createCard(ctx, deck.id, 'one', '1');
    ctx.advance(1);
    const c2 = await createCard(ctx, deck.id, 'two', '2');
    ctx.advance(1);
    const c3 = await createCard(ctx, deck.id, 'three', '3');
    await deleteCard(ctx, c3.id);
    const view = await loadDeckView(ctx, deck.id, opts);
    expect(view?.deck.name).toBe('D');
    expect(view?.cards.map((c) => c.id)).toEqual([c1.id, c2.id]);
    expect(view?.counts.new).toBe(2);
    await deleteDeck(ctx, deck.id);
    expect(await loadDeckView(ctx, deck.id, opts)).toBeNull();
  });

  it('searches front and back, case-insensitively, ignoring surrounding spaces', () => {
    const cards = [
      { id: '1', front: 'What is ACID?', back: 'Atomicity…' },
      { id: '2', front: 'Normal forms', back: 'BCNF is stricter than 3NF' },
      { id: '3', front: 'Index', back: 'B-tree' },
    ];
    expect(searchCards(cards, '  acid ').map((c) => c.id)).toEqual(['1']);
    expect(searchCards(cards, 'bcnf').map((c) => c.id)).toEqual(['2']);
    expect(searchCards(cards, 'b').map((c) => c.id)).toEqual(['2', '3']);
    expect(searchCards(cards, '')).toEqual(cards);
  });
});

describe('loadNextDue (session complete screen)', () => {
  it('reports nothing scheduled when no card has been studied', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    await createCard(ctx, deck.id, 'f', 'b');
    expect(await loadNextDue(ctx, opts)).toEqual({ kind: 'none' });
  });

  it('reports learning cards still due later today', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    await rateCard(ctx, { cardId: card.id, rating: 1, durationMs: 1 }); // due in 1 minute
    expect(await loadNextDue(ctx, opts)).toEqual({ kind: 'laterToday', count: 1 });
  });

  it('counts cards due tomorrow', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    for (let i = 0; i < 2; i++) {
      const card = await createCard(ctx, deck.id, `f${String(i)}`, 'b');
      await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 1 });
    }
    const states = await ctx.db.cardStates.toArray();
    // Make both due tomorrow afternoon (2026-10-11 15:00 IST).
    for (const s of states) {
      await ctx.db.cardStates.put({ ...s, due: Date.parse('2026-10-11T09:30:00Z') });
    }
    expect(await loadNextDue(ctx, opts)).toEqual({ kind: 'tomorrow', count: 2 });
  });

  it('otherwise gives the next study day with cards due', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 1 });
    const state = await ctx.db.cardStates.get(card.id);
    if (!state) throw new Error('missing');
    await ctx.db.cardStates.put({ ...state, due: AFTERNOON + 5 * DAY + MINUTE });
    expect(await loadNextDue(ctx, opts)).toEqual({ kind: 'later', day: '2026-10-15', count: 1 });
  });
});

describe('Home data for the new design', () => {
  it('deck rows carry card count and source; totals include tomorrow and the estimate', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'A');
    const cards = [];
    for (let i = 0; i < 3; i++) cards.push(await createCard(ctx, deck.id, `q${String(i)}`, 'a'));
    const deleted = await createCard(ctx, deck.id, 'gone', 'a');
    await deleteCard(ctx, deleted.id);
    // One card due tomorrow afternoon (2026-10-11 15:00 IST).
    const first = cards[0];
    if (!first) throw new Error('no card');
    await rateCard(ctx, { cardId: first.id, rating: 4, durationMs: 1 });
    const s = await ctx.db.cardStates.get(first.id);
    if (!s) throw new Error('no state');
    await ctx.db.cardStates.put({ ...s, due: Date.parse('2026-10-11T09:30:00Z') });

    const home = await loadHome(ctx, opts);
    expect(home.decks[0]).toMatchObject({ name: 'A', cardCount: 3, source: 'user' });
    expect(home.tomorrow).toBe(1);
    expect(home.estimateMinutes).toBeNull(); // fewer than 20 reviews so far
  });

  it('gives a time estimate once there are 20 reviews', async () => {
    const ctx = await setup();
    await updateSettings(ctx, { newPerDay: 50 });
    const deck = await createDeck(ctx, 'A');
    const cards = [];
    for (let i = 0; i < 25; i++) cards.push(await createCard(ctx, deck.id, `q${String(i)}`, 'a'));
    for (const card of cards.slice(0, 20)) {
      await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 30_000 });
    }
    const home = await loadHome(ctx, opts);
    // 5 new cards left × 30 s median = 2.5 min → 3 (rounded half away from zero).
    expect(home.counts.new).toBe(5);
    expect(home.estimateMinutes).toBe(3);
  });
});

describe('Deck view data for the new design', () => {
  it('includes each card’s scheduling state, the deck source and when it was last studied', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    const a = await createCard(ctx, deck.id, 'a', 'a');
    await createCard(ctx, deck.id, 'b', 'b');
    let view = await loadDeckView(ctx, deck.id, opts);
    expect(view?.lastStudiedAt).toBeNull();
    expect(view?.deck.source).toBe('user');
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: a.id, rating: 4, durationMs: 1 });
    view = await loadDeckView(ctx, deck.id, opts);
    expect(view?.lastStudiedAt).toBe(AFTERNOON + MINUTE);
    expect(view?.cards.map((c) => c.state.state)).toEqual(['review', 'new']);
    expect(view?.timeZone).toBe('Asia/Kolkata');
    expect(view?.rolloverHour).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import { initialize } from '../src/services/bootstrap';
import { createCard } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import { loadQueue, nextCard, remainingCount } from '../src/services/queue';
import { rateCard, undoLastReview } from '../src/services/review';
import { endSession, startSession } from '../src/services/session';
import { updateSettings } from '../src/services/settings';
import { HOUR, makeTestContext, MINUTE } from './helpers';

// 2026-10-10 05:00 IST (Asia/Kolkata, UTC+5:30), early in the "2026-10-10" study day.
const MORNING = Date.parse('2026-10-09T23:30:00Z');
const TZ = 'Asia/Kolkata';
// Next rollover: 2026-10-11 04:00 IST.
const NEXT_ROLLOVER = Date.parse('2026-10-10T22:30:00Z');

async function setup(newCardCount: number, newPerDay: number) {
  const ctx = makeTestContext(MORNING);
  await initialize(ctx, { requestPersist: undefined });
  await updateSettings(ctx, { newPerDay, timeZone: TZ });
  const deck = await createDeck(ctx, 'D');
  const cards = [];
  for (let i = 0; i < newCardCount; i++) {
    cards.push(await createCard(ctx, deck.id, `f${String(i)}`, `b${String(i)}`));
    ctx.advance(1);
  }
  return { ctx, deck, cards };
}

describe('loadQueue', () => {
  it('builds the queue from the database using the stored settings', async () => {
    const { ctx, cards } = await setup(8, 5);
    const queue = await loadQueue(ctx, { browserTimeZone: 'UTC' });
    expect(queue.newCards).toEqual(cards.slice(0, 5).map((c) => c.id));
    expect(queue.due).toEqual([]);
  });

  it('respects the new-card limit across sessions in a study day, and resets at the rollover', async () => {
    const { ctx } = await setup(8, 5);
    const study = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const queue = await loadQueue(ctx, { browserTimeZone: 'UTC' });
        const next = nextCard(queue);
        if (!next) throw new Error('nothing to study');
        // Easy graduates the card, so it isn't due again today.
        await rateCard(ctx, { cardId: next.cardId, rating: 4, durationMs: 1 });
        ctx.advance(MINUTE);
      }
    };

    await startSession(ctx, null, 'UTC');
    await study(3);
    await endSession(ctx);
    expect((await loadQueue(ctx, { browserTimeZone: 'UTC' })).newCards).toHaveLength(2);

    ctx.advance(6 * HOUR); // a second session, same study day
    await startSession(ctx, null, 'UTC');
    await study(2);
    await endSession(ctx);
    expect((await loadQueue(ctx, { browserTimeZone: 'UTC' })).newCards).toEqual([]);

    ctx.setNow(NEXT_ROLLOVER - 1); // 03:59:59.999 IST: still the same study day
    expect((await loadQueue(ctx, { browserTimeZone: 'UTC' })).newCards).toEqual([]);

    ctx.setNow(NEXT_ROLLOVER); // 04:00 IST: a new study day
    expect((await loadQueue(ctx, { browserTimeZone: 'UTC' })).newCards).toHaveLength(3);
  });

  it('an undone first review frees its new-card slot', async () => {
    const { ctx } = await setup(3, 1);
    const queue = await loadQueue(ctx, { browserTimeZone: 'UTC' });
    const first = nextCard(queue);
    if (!first) throw new Error('nothing to study');
    await rateCard(ctx, { cardId: first.cardId, rating: 4, durationMs: 1 });
    expect((await loadQueue(ctx, { browserTimeZone: 'UTC' })).newCards).toEqual([]);
    ctx.advance(MINUTE);
    await undoLastReview(ctx, MORNING);
    expect((await loadQueue(ctx, { browserTimeZone: 'UTC' })).newCards).toEqual([first.cardId]);
  });

  it('can be scoped to one deck', async () => {
    const { ctx, cards } = await setup(2, 20);
    const other = await createDeck(ctx, 'Other');
    const otherCard = await createCard(ctx, other.id, 'x', 'y');
    const queue = await loadQueue(ctx, { browserTimeZone: 'UTC', deckId: other.id });
    expect(queue.newCards).toEqual([otherCard.id]);
    expect(queue.newCards).not.toContain(cards[0]?.id);
  });
});

describe('nextCard and remainingCount', () => {
  const base = { counts: { due: 0, new: 0, learning: 0 } };

  it('takes due cards first, then new cards, then a learn-ahead card', () => {
    expect(nextCard({ ...base, due: ['a'], newCards: ['b'], learnAheadNext: null })).toEqual({
      cardId: 'a',
      kind: 'due',
    });
    expect(nextCard({ ...base, due: [], newCards: ['b'], learnAheadNext: null })).toEqual({
      cardId: 'b',
      kind: 'new',
    });
    expect(
      nextCard({ ...base, due: [], newCards: [], learnAheadNext: { cardId: 'c', due: 1 } }),
    ).toEqual({ cardId: 'c', kind: 'learnAhead' });
    expect(nextCard({ ...base, due: [], newCards: [], learnAheadNext: null })).toBeNull();
  });

  it('counts due + new cards, plus a learn-ahead card when that is all that is left', () => {
    expect(
      remainingCount({ ...base, due: ['a', 'b'], newCards: ['c'], learnAheadNext: null }),
    ).toBe(3);
    expect(
      remainingCount({ ...base, due: [], newCards: [], learnAheadNext: { cardId: 'c', due: 1 } }),
    ).toBe(1);
  });
});

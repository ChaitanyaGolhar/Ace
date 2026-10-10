import { buildQueue } from '@recall/core';
import { describe, expect, it } from 'vitest';
import type { LocalReviewLog } from '../src/db/db';
import { initialize } from '../src/services/bootstrap';
import { createCard } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import { estimateStudyMinutes } from '../src/services/estimate';
import { loadDeckView, loadHome } from '../src/services/overview';
import { loadQueue, loadQueueInput } from '../src/services/queue';
import { rateCard, undoLastReview } from '../src/services/review';
import { DAY, HOUR, makeTestContext, MINUTE, T0, type TestContext } from './helpers';

// The screens read less of the review log than "all of it" (big decks, D-317). These
// tests pin down that every number they show is exactly what a full read gives.

const TZ = 'Asia/Kolkata';

/** A history with every edge the new-card limit cares about, plus old reviews. */
async function history(): Promise<{ ctx: TestContext; deckId: string; otherDeckId: string }> {
  const ctx = makeTestContext(T0);
  await initialize(ctx, { requestPersist: undefined });
  const deck = await createDeck(ctx, 'D');
  const other = await createDeck(ctx, 'Other');
  const [a, b, c, e] = [
    await createCard(ctx, deck.id, 'a', 'a'),
    await createCard(ctx, deck.id, 'b', 'b'),
    await createCard(ctx, deck.id, 'c', 'c'),
    await createCard(ctx, deck.id, 'e', 'e'),
  ];
  for (let i = 0; i < 30; i++) await createCard(ctx, deck.id, `new ${String(i)}`, 'x');
  const old = await createCard(ctx, other.id, 'old', 'old');

  const log = (cardId: string, at: number, voidedAt: number | null = null): LocalReviewLog => ({
    id: ctx.newId(),
    cardId,
    rating: 3,
    reviewedAt: at,
    durationMs: 7000,
    deviceId: 'other-device',
    voidedAt,
    dirty: 0,
    localVersion: 1,
  });
  await ctx.db.reviewLogs.bulkAdd([
    // A: first seen 3 days ago, reviewed again today (not introduced today).
    log(a.id, T0 - 3 * DAY),
    log(a.id, T0 - 2 * HOUR),
    // E: first seen 40 hours ago (inside the 48 h window, but not today).
    log(e.id, T0 - 40 * HOUR),
    // Old card in another deck, many reviews long ago (for the estimate's median).
    ...Array.from({ length: 300 }, (_, i) => log(old.id, T0 - (200 - i / 2) * DAY)),
  ]);
  // B: first reviewed today. C: reviewed today, then undone (its slot is free again).
  await rateCard(ctx, { cardId: b.id, rating: 3, durationMs: 4000 });
  ctx.advance(MINUTE);
  await rateCard(ctx, { cardId: c.id, rating: 3, durationMs: 4000 });
  await undoLastReview(ctx, T0 - HOUR);
  ctx.advance(MINUTE);
  return { ctx, deckId: deck.id, otherDeckId: other.id };
}

describe('reading only what the queue needs', () => {
  it('the queue is exactly what a full read gives, for every deck and for all decks', async () => {
    const { ctx, deckId, otherDeckId } = await history();
    const full = await loadQueueInput(ctx, TZ);
    expect(await loadQueue(ctx, { browserTimeZone: TZ })).toEqual(buildQueue(full));
    for (const id of [deckId, otherDeckId]) {
      expect(await loadQueue(ctx, { browserTimeZone: TZ, deckId: id })).toEqual(
        buildQueue({ ...full, deckId: id }),
      );
    }
    // B was introduced today; C's undone review freed its slot; A and E were earlier.
    expect(buildQueue(full).counts.new).toBe(20 - 1);
  });

  it('the queue path reads only the history of recently reviewed cards', async () => {
    const { ctx } = await history();
    const full = await loadQueueInput(ctx, TZ);
    const narrow = await loadQueueInput(ctx, TZ, { logs: 'newLimit' });
    expect(full.logs.length).toBe(305);
    expect(new Set(narrow.logs.map((l) => l.cardId)).size).toBe(4); // A, B, C, E
    expect(narrow.logs.length).toBe(5);
  });

  it('Home and the deck page show the same numbers as with a full read', async () => {
    const { ctx, deckId, otherDeckId } = await history();
    const full = await loadQueueInput(ctx, TZ);
    const home = await loadHome(ctx, { browserTimeZone: TZ });
    expect(home.counts).toEqual(buildQueue(full).counts);
    expect(home.estimateMinutes).toBe(
      estimateStudyMinutes(full.logs, home.counts.due + home.counts.learning + home.counts.new),
    );
    expect(home.estimateMinutes).not.toBeNull();

    const view = await loadDeckView(ctx, deckId, { browserTimeZone: TZ });
    expect(view?.counts).toEqual(buildQueue({ ...full, deckId }).counts);
    // B's review today is the deck's latest non-undone review (C's was undone).
    const bLog = full.logs.filter((l) => l.voidedAt === null && l.deviceId !== 'other-device');
    expect(view?.lastStudiedAt).toBe(Math.max(...bLog.map((l) => l.reviewedAt)));
    const otherView = await loadDeckView(ctx, otherDeckId, { browserTimeZone: TZ });
    expect(otherView?.lastStudiedAt).toBe(T0 - (200 - 299 / 2) * DAY);
  });
});

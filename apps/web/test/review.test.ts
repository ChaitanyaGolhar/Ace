import { describe, expect, it } from 'vitest';
import { previewIntervals, replay, type Rating } from '@recall/core';
import { initialize } from '../src/services/bootstrap';
import { createCard } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import {
  lastSessionRating,
  loadReviewCard,
  rateCard,
  undoLastReview,
} from '../src/services/review';
import { getMeta } from '../src/db/meta';
import { DAY, makeTestContext, MINUTE, T0, type TestContext } from './helpers';

async function setup() {
  const ctx = makeTestContext();
  await initialize(ctx, { requestPersist: undefined });
  const deck = await createDeck(ctx, 'D');
  const card = await createCard(ctx, deck.id, 'front', 'back');
  return { ctx, deck, card };
}

async function stateOf(ctx: TestContext, cardId: string) {
  return ctx.db.cardStates.get(cardId);
}

describe('rateCard', () => {
  it('inserts a dirty log and stores the replayed CardState', async () => {
    const { ctx, card } = await setup();
    ctx.advance(MINUTE);
    const { log, state } = await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 4200 });
    const deviceId = await getMeta(ctx.db, 'deviceId');
    expect(await ctx.db.reviewLogs.get(log.id)).toEqual({
      id: log.id,
      cardId: card.id,
      rating: 3,
      reviewedAt: T0 + MINUTE,
      durationMs: 4200,
      deviceId,
      voidedAt: null,
      outcome: null,
      dirty: 1,
      localVersion: 1,
    });
    expect(await stateOf(ctx, card.id)).toEqual(state);
    expect(state).toEqual(replay(card, [log]));
  });

  it('recomputes by replaying all of the card’s logs, including ones from other devices', async () => {
    const { ctx, card } = await setup();
    // A log synced from another device whose clock is ahead of ours.
    const remote = {
      id: ctx.newId(),
      cardId: card.id,
      rating: 1 as const,
      reviewedAt: T0 + 2 * DAY,
      durationMs: 1000,
      deviceId: 'other-device',
      voidedAt: null,
      outcome: null,
      dirty: 0 as const,
      localVersion: 1,
    };
    await ctx.db.reviewLogs.add(remote);
    ctx.advance(DAY);
    const { log, state } = await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 1 });
    expect(state).toEqual(replay(card, [remote, log]));
  });

  it('schedules exactly what previewIntervals showed, for every rating', async () => {
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      const { ctx, card } = await setup();
      ctx.advance(MINUTE);
      const before = await stateOf(ctx, card.id);
      if (!before) throw new Error('missing state');
      const preview = previewIntervals(before, ctx.now());
      const { state } = await rateCard(ctx, { cardId: card.id, rating, durationMs: 1 });
      expect(state.due - ctx.now()).toBe(preview[rating]);
    }
  });

  it('is atomic: if saving the CardState fails, no log is stored', async () => {
    const { ctx, card } = await setup();
    const fail = () => {
      throw new Error('simulated crash');
    };
    ctx.db.cardStates.hook('creating', fail);
    ctx.db.cardStates.hook('updating', fail);
    await expect(rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 })).rejects.toThrow(
      'simulated crash',
    );
    expect(await ctx.db.reviewLogs.count()).toBe(0);
  });

  it('is atomic: if saving the log fails, the CardState is unchanged', async () => {
    const { ctx, card } = await setup();
    const before = await stateOf(ctx, card.id);
    ctx.db.reviewLogs.hook('creating', () => {
      throw new Error('simulated crash');
    });
    await expect(rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 })).rejects.toThrow();
    expect(await stateOf(ctx, card.id)).toEqual(before);
  });

  it('rejects unknown or deleted cards and invalid input', async () => {
    const { ctx, deck, card } = await setup();
    await expect(
      rateCard(ctx, { cardId: ctx.newId(), rating: 3, durationMs: 1 }),
    ).rejects.toThrow();
    await expect(
      rateCard(ctx, { cardId: card.id, rating: 5 as Rating, durationMs: 1 }),
    ).rejects.toThrow();
    await expect(rateCard(ctx, { cardId: card.id, rating: 3, durationMs: -5 })).rejects.toThrow();
    const gone = await createCard(ctx, deck.id, 'x', 'y');
    await ctx.db.cards.update(gone.id, { deletedAt: T0 });
    await expect(rateCard(ctx, { cardId: gone.id, rating: 3, durationMs: 1 })).rejects.toThrow();
    expect(await ctx.db.reviewLogs.count()).toBe(0);
  });
});

describe('undoLastReview', () => {
  it('restores the previous CardState, including the due date, exactly', async () => {
    const { ctx, card } = await setup();
    const sessionStart = ctx.now();
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 });
    ctx.advance(10 * MINUTE);
    const before = await stateOf(ctx, card.id);
    await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 1 });
    expect((await stateOf(ctx, card.id))?.due).not.toBe(before?.due);

    ctx.advance(MINUTE);
    const undone = await undoLastReview(ctx, sessionStart);
    expect(undone?.cardId).toBe(card.id);
    expect(await stateOf(ctx, card.id)).toEqual(before);
  });

  it('voids the log (dirty, localVersion+1) instead of deleting it', async () => {
    const { ctx, card } = await setup();
    const { log } = await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 });
    await ctx.db.reviewLogs.update(log.id, { dirty: 0 });
    ctx.advance(MINUTE);
    await undoLastReview(ctx, T0);
    expect(await ctx.db.reviewLogs.get(log.id)).toMatchObject({
      voidedAt: T0 + MINUTE,
      outcome: null,
      dirty: 1,
      localVersion: 2,
    });
  });

  it('undoes reviews one by one, newest first, then returns null', async () => {
    const { ctx, deck, card } = await setup();
    const second = await createCard(ctx, deck.id, 'f2', 'b2');
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 });
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: second.id, rating: 3, durationMs: 1 });
    ctx.advance(MINUTE);
    expect((await undoLastReview(ctx, T0))?.cardId).toBe(second.id);
    expect((await undoLastReview(ctx, T0))?.cardId).toBe(card.id);
    expect(await undoLastReview(ctx, T0)).toBeNull();
    expect((await stateOf(ctx, card.id))?.state).toBe('new');
  });

  it('only undoes this device’s reviews from the current session', async () => {
    const { ctx, card } = await setup();
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 }); // before session
    ctx.advance(DAY);
    const sessionStart = ctx.now();
    await ctx.db.reviewLogs.add({
      id: ctx.newId(),
      cardId: card.id,
      rating: 1,
      reviewedAt: sessionStart + MINUTE,
      durationMs: 1,
      deviceId: 'other-device',
      voidedAt: null,
      outcome: null,
      dirty: 0,
      localVersion: 1,
    });
    ctx.advance(2 * MINUTE);
    expect(await undoLastReview(ctx, sessionStart)).toBeNull();
  });
});

describe('loadReviewCard', () => {
  it('returns the card, its state and the interval preview for each rating', async () => {
    const { ctx, card } = await setup();
    const loaded = await loadReviewCard(ctx, card.id);
    expect(loaded?.card).toEqual({
      id: card.id,
      front: 'front',
      back: 'back',
      type: 'basic',
      content: { type: 'basic', front: 'front', back: 'back' },
    });
    const state = await stateOf(ctx, card.id);
    if (!state) throw new Error('missing state');
    expect(loaded?.preview).toEqual(previewIntervals(state, ctx.now()));
  });

  it('returns null for a missing or deleted card', async () => {
    const { ctx, card } = await setup();
    expect(await loadReviewCard(ctx, ctx.newId())).toBeNull();
    await ctx.db.cards.update(card.id, { deletedAt: T0 });
    expect(await loadReviewCard(ctx, card.id)).toBeNull();
  });
});

describe('lastSessionRating (undo pill)', () => {
  it('is the rating of this device’s latest non-undone review in the session', async () => {
    const { ctx, deck, card } = await setup();
    const other = await createCard(ctx, deck.id, 'f2', 'b2');
    const start = ctx.now();
    expect(await lastSessionRating(ctx, start)).toBeNull();
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1 });
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: other.id, rating: 1, durationMs: 1 });
    expect(await lastSessionRating(ctx, start)).toBe(1);
    ctx.advance(MINUTE);
    await undoLastReview(ctx, start);
    expect(await lastSessionRating(ctx, start)).toBe(3);
  });
});

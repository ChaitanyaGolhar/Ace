import { describe, expect, it } from 'vitest';
import { initialize } from '../src/services/bootstrap';
import { createCard } from '../src/services/cards';
import { createDeck } from '../src/services/decks';
import { rateCard, undoLastReview } from '../src/services/review';
import { endSession, getSession, sessionSummary, startSession } from '../src/services/session';
import { updateSettings } from '../src/services/settings';
import { DAY, makeTestContext, MINUTE, T0 } from './helpers';

async function setup() {
  const ctx = makeTestContext();
  await initialize(ctx, { requestPersist: undefined });
  await updateSettings(ctx, { timeZone: 'Asia/Kolkata' });
  return ctx;
}

describe('sessions', () => {
  it('starts a session and continues it after a reload (same deck, same study day)', async () => {
    const ctx = await setup();
    const first = await startSession(ctx, null, 'UTC');
    ctx.advance(30 * MINUTE);
    const again = await startSession(ctx, null, 'UTC');
    expect(again).toEqual(first);
    expect(await getSession(ctx)).toEqual({ startedAt: T0, deckId: null });
  });

  it('starts a fresh session for a different deck or a new study day', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    await startSession(ctx, null, 'UTC');
    ctx.advance(MINUTE);
    expect(await startSession(ctx, deck.id, 'UTC')).toEqual({
      startedAt: T0 + MINUTE,
      deckId: deck.id,
    });
    ctx.advance(DAY);
    expect((await startSession(ctx, deck.id, 'UTC')).startedAt).toBe(T0 + MINUTE + DAY);
  });

  it('endSession clears it', async () => {
    const ctx = await setup();
    await startSession(ctx, null, 'UTC');
    await endSession(ctx);
    expect(await getSession(ctx)).toBeNull();
  });

  it('summarises reviews in the session: count and time spent, excluding undone ones', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    const a = await createCard(ctx, deck.id, 'a', 'a');
    const b = await createCard(ctx, deck.id, 'b', 'b');
    await rateCard(ctx, { cardId: a.id, rating: 4, durationMs: 9_000 }); // before the session
    ctx.advance(MINUTE);
    const session = await startSession(ctx, null, 'UTC');
    await rateCard(ctx, { cardId: a.id, rating: 3, durationMs: 3_000 });
    await rateCard(ctx, { cardId: b.id, rating: 3, durationMs: 5_000 });
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: b.id, rating: 1, durationMs: 7_000 });
    ctx.advance(MINUTE);
    await undoLastReview(ctx, session.startedAt);
    expect(await sessionSummary(ctx, session)).toEqual({ reviewed: 2, timeSpentMs: 8_000 });
  });
});

import {
  initialState,
  previewIntervals,
  RatingSchema,
  ReviewLogSchema,
  type CardState,
  type Rating,
} from '@recall/core';
import type { LocalReviewLog } from '../db/db';
import { getMeta } from '../db/meta';
import type { AppContext } from './context';
import { NotFoundError } from './errors';
import { recomputeCardState } from './states';

export interface RateInput {
  cardId: string;
  rating: Rating;
  /** Time from the card being shown to the rating. */
  durationMs: number;
}

async function requireDeviceId(ctx: AppContext): Promise<string> {
  const deviceId = await getMeta(ctx.db, 'deviceId');
  if (deviceId === undefined) throw new Error('initialize() must run before reviewing');
  return deviceId;
}

/**
 * Records a rating. The log insert and the CardState update happen in one Dexie
 * transaction, so a crash or reload can never leave one without the other.
 *
 * The new state comes from replaying *all* of the card's logs rather than applying
 * this one review to the stored state. That stays correct even when a synced log
 * from another device has a later timestamp than this one.
 */
export async function rateCard(
  ctx: AppContext,
  input: RateInput,
): Promise<{ log: LocalReviewLog; state: CardState }> {
  const rating = RatingSchema.parse(input.rating);
  const { db } = ctx;
  const deviceId = await requireDeviceId(ctx);
  return db.transaction('rw', [db.cards, db.reviewLogs, db.cardStates], async () => {
    const card = await db.cards.get(input.cardId);
    if (!card || card.deletedAt !== null) throw new NotFoundError('Card', input.cardId);
    const log = ReviewLogSchema.parse({
      id: ctx.newId(),
      cardId: card.id,
      rating,
      reviewedAt: ctx.now(),
      durationMs: Math.round(input.durationMs),
      deviceId,
      voidedAt: null,
    });
    const row: LocalReviewLog = { ...log, dirty: 1, localVersion: 1 };
    await db.reviewLogs.add(row);
    const state = await recomputeCardState(ctx, card);
    return { log: row, state };
  });
}

/**
 * Undoes this device's most recent review in the current session: the log is voided
 * (never deleted; logs are append-only), then the card is replayed without it.
 * Returns the affected card, or null if there is nothing to undo.
 */
export async function undoLastReview(
  ctx: AppContext,
  sessionStartedAt: number,
): Promise<{ cardId: string; logId: string } | null> {
  const { db } = ctx;
  const deviceId = await requireDeviceId(ctx);
  return db.transaction('rw', [db.cards, db.reviewLogs, db.cardStates], async () => {
    const candidates = await db.reviewLogs
      .where('reviewedAt')
      .aboveOrEqual(sessionStartedAt)
      .filter((log) => log.voidedAt === null && log.deviceId === deviceId)
      .toArray();
    const latest = candidates.sort(
      (a, b) => b.reviewedAt - a.reviewedAt || (b.id > a.id ? 1 : -1),
    )[0];
    if (!latest) return null;
    await db.reviewLogs.put({
      ...latest,
      voidedAt: ctx.now(),
      dirty: 1,
      localVersion: latest.localVersion + 1,
    });
    const card = await db.cards.get(latest.cardId);
    if (card) await recomputeCardState(ctx, card);
    return { cardId: latest.cardId, logId: latest.id };
  });
}

export interface ReviewCard {
  card: { id: string; front: string; back: string };
  state: CardState;
  /** ms until due for each rating, as of now: the labels on the rating buttons. */
  preview: Record<Rating, number>;
}

/** The card to show in the review screen, or null if it no longer exists. */
export async function loadReviewCard(ctx: AppContext, cardId: string): Promise<ReviewCard | null> {
  const card = await ctx.db.cards.get(cardId);
  if (!card || card.deletedAt !== null) return null;
  const state = (await ctx.db.cardStates.get(cardId)) ?? initialState(card);
  return {
    card: { id: card.id, front: card.front, back: card.back },
    state,
    preview: previewIntervals(state, ctx.now()),
  };
}

/** Rating of this device's latest non-undone review since the session started (undo pill). */
export async function lastSessionRating(
  ctx: AppContext,
  sessionStartedAt: number,
): Promise<Rating | null> {
  const deviceId = await getMeta(ctx.db, 'deviceId');
  const logs = await ctx.db.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(sessionStartedAt)
    .filter((log) => log.voidedAt === null && log.deviceId === deviceId)
    .toArray();
  const latest = logs.sort((a, b) => b.reviewedAt - a.reviewedAt || (b.id > a.id ? 1 : -1))[0];
  return latest?.rating ?? null;
}

// The only module that talks to ts-fsrs. Everything else in the codebase works with
// our own types (CardState, ReviewLog, epoch-ms numbers) and never imports ts-fsrs.

import {
  default_maximum_interval,
  default_request_retention,
  fsrs,
  Rating as FsrsRating,
  State as FsrsState,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
} from 'ts-fsrs';
import { mergeLog } from './merge';
import type { Card, Rating, ReviewLog } from './schemas';
import type { CardState } from './types';

/**
 * Bump whenever scheduling output could change for the same logs: FSRS params,
 * the replay logic, or the ts-fsrs version. Clients rebuild every CardState by
 * replay when their stored version differs (invariant 8). `test/golden.test.ts`
 * fails if output changes without a bump.
 */
export const SCHEDULER_VERSION = 1;

export interface SchedulerParams {
  /** Target probability of recalling a card when it comes due, in (0, 1]. */
  requestRetention: number;
  /** Upper bound on any interval, in days. */
  maximumIntervalDays: number;
}

/** ts-fsrs defaults. v1 never customises these (see brief §3). */
export const DEFAULT_SCHEDULER_PARAMS: Readonly<SchedulerParams> = Object.freeze({
  requestRetention: default_request_retention,
  maximumIntervalDays: default_maximum_interval,
});

const STATE_FROM_FSRS: Record<FsrsState, CardState['state']> = {
  [FsrsState.New]: 'new',
  [FsrsState.Learning]: 'learning',
  [FsrsState.Review]: 'review',
  [FsrsState.Relearning]: 'relearning',
};

const STATE_TO_FSRS: Record<CardState['state'], FsrsState> = {
  new: FsrsState.New,
  learning: FsrsState.Learning,
  review: FsrsState.Review,
  relearning: FsrsState.Relearning,
};

const GRADE: Record<Rating, Grade> = {
  1: FsrsRating.Again,
  2: FsrsRating.Hard,
  3: FsrsRating.Good,
  4: FsrsRating.Easy,
};

// Building an FSRS instance precomputes parameter-derived constants, so reuse one
// per distinct params. This is memoisation, not state: outputs depend only on inputs.
const schedulers = new Map<string, FSRS>();

function schedulerFor(params: SchedulerParams): FSRS {
  const key = `${String(params.requestRetention)}|${String(params.maximumIntervalDays)}`;
  let scheduler = schedulers.get(key);
  if (scheduler === undefined) {
    scheduler = fsrs({
      request_retention: params.requestRetention,
      maximum_interval: params.maximumIntervalDays,
      // Fuzz randomises intervals slightly. Off, so the interval shown on a button
      // is exactly what the card gets. (Explicit, although it is the default.)
      enable_fuzz: false,
      enable_short_term: true,
    });
    schedulers.set(key, scheduler);
  }
  return scheduler;
}

function toFsrsCard(state: CardState): FsrsCard {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    // ts-fsrs recomputes elapsed_days from last_review on every review, and only
    // writes scheduled_days (never reads it), so neither needs to be stored.
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: STATE_TO_FSRS[state.state],
    ...(state.lastReviewedAt === null ? {} : { last_review: new Date(state.lastReviewedAt) }),
  };
}

function fromFsrsCard(cardId: string, card: FsrsCard): CardState {
  return {
    cardId,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_FROM_FSRS[card.state],
    lastReviewedAt: card.last_review?.getTime() ?? null,
    learningSteps: card.learning_steps,
  };
}

export function initialState(card: Card): CardState {
  return {
    cardId: card.id,
    due: card.createdAt,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReviewedAt: null,
    learningSteps: 0,
  };
}

/**
 * Applies one review to a state. Logs must arrive in replay order, so a log older
 * than the last review is rejected rather than silently giving a different result
 * from `replay`. It does not check `voidedAt`: filtering voided logs is replay's job.
 */
export function applyReview(
  state: CardState,
  log: ReviewLog,
  params: SchedulerParams = DEFAULT_SCHEDULER_PARAMS,
): CardState {
  if (log.cardId !== state.cardId) {
    throw new Error(`applyReview: log ${log.id} is for card ${log.cardId}, not ${state.cardId}`);
  }
  if (state.lastReviewedAt !== null && log.reviewedAt < state.lastReviewedAt) {
    throw new RangeError(
      `applyReview: log ${log.id} (${String(log.reviewedAt)}) is older than the last review ` +
        `(${String(state.lastReviewedAt)}); use replay() instead`,
    );
  }
  const result = schedulerFor(params).next(
    toFsrsCard(state),
    new Date(log.reviewedAt),
    GRADE[log.rating],
  );
  return fromFsrsCard(state.cardId, result.card);
}

/** Replay order: by time, then by id so that equal timestamps still sort the same everywhere. */
function compareLogs(a: ReviewLog, b: ReviewLog): number {
  if (a.reviewedAt !== b.reviewedAt) return a.reviewedAt - b.reviewedAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Derives a card's scheduling state from its review log. This is the source of
 * truth: any CardState stored anywhere is just a cache of this function's output.
 *
 * - logs for other cards are ignored, so callers may pass a superset;
 * - copies of the same log (same id) are merged with `mergeLog`, so they count once
 *   and a log is voided if any copy of it is;
 * - voided logs are dropped;
 * - the rest are applied in (reviewedAt, id) order, whatever order they came in.
 */
export function replay(
  card: Card,
  logs: readonly ReviewLog[],
  params: SchedulerParams = DEFAULT_SCHEDULER_PARAMS,
): CardState {
  const byId = new Map<string, ReviewLog>();
  for (const log of logs) {
    if (log.cardId !== card.id) continue;
    const existing = byId.get(log.id);
    byId.set(log.id, existing === undefined ? log : mergeLog(existing, log));
  }
  return [...byId.values()]
    .filter((log) => log.voidedAt === null)
    .sort(compareLogs)
    .reduce((state, log) => applyReview(state, log, params), initialState(card));
}

/** Milliseconds from `now` until the card would be due, for each rating. For the rating buttons. */
export function previewIntervals(
  state: CardState,
  now: number,
  params: SchedulerParams = DEFAULT_SCHEDULER_PARAMS,
): Record<Rating, number> {
  const preview = schedulerFor(params).repeat(toFsrsCard(state), new Date(now));
  const interval = (rating: Rating) => preview[GRADE[rating]].card.due.getTime() - now;
  return { 1: interval(1), 2: interval(2), 3: interval(3), 4: interval(4) };
}

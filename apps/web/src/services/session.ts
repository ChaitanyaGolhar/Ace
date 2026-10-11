import { studyDayKey, type Outcome } from '@recall/core';
import { getMeta, setMeta, type Session } from '../db/meta';
import type { AppContext } from './context';
import { recordEvent } from './events';
import { loadQueue } from './queue';
import { effectiveTimeZone, getSettings } from './settings';

export async function getSession(ctx: AppContext): Promise<Session | null> {
  return (await getMeta(ctx.db, 'session')) ?? null;
}

/**
 * Starts a study session, or continues the stored one if it is for the same deck and
 * the same study day (so a reload mid-session picks up where it left off). The
 * session only marks a start time: which card comes next always comes from the
 * queue, so no other session state is needed for correctness.
 *
 * `cap` (feel pass, "Start with 20"): the session shows only the `cap` most overdue
 * due cards, chosen now. A capped and a full session never continue each other.
 */
export async function startSession(
  ctx: AppContext,
  deckId: string | null,
  browserTimeZone: string,
  unit?: number,
  cap?: number,
): Promise<Session> {
  const settings = await getSettings(ctx);
  const tz = effectiveTimeZone(settings, browserTimeZone);
  const now = ctx.now();
  const existing = await getSession(ctx);
  if (
    existing &&
    existing.completedAt === undefined &&
    existing.deckId === deckId &&
    existing.unit === unit &&
    (existing.cap !== undefined) === (cap !== undefined) &&
    studyDayKey(existing.startedAt, tz, settings.rolloverHour) ===
      studyDayKey(now, tz, settings.rolloverHour)
  ) {
    return existing;
  }
  const queue = await loadQueue(ctx, {
    browserTimeZone,
    ...(deckId === null ? {} : { deckId }),
    ...(unit === undefined ? {} : { unit }),
  });
  const { counts } = queue;
  const session: Session = {
    startedAt: now,
    deckId,
    ...(unit === undefined ? {} : { unit }),
    // queue.due is most overdue first (core: by due, then id).
    ...(cap === undefined ? {} : { cap: queue.due.slice(0, cap) }),
  };
  await setMeta(ctx.db, 'session', session);
  await recordEvent(ctx, 'session_started', {
    scope: deckId === null ? 'all' : 'deck',
    due: counts.due + counts.learning,
    new: counts.new,
  });
  if (cap !== undefined) {
    await recordEvent(ctx, 'capped_session_started', { cap, due: counts.due + counts.learning });
  }
  return session;
}

/** Marks the session finished (idempotent). Its summary can still be read. */
export async function completeSession(ctx: AppContext): Promise<void> {
  const session = await getSession(ctx);
  if (session && session.completedAt === undefined) {
    await setMeta(ctx.db, 'session', { ...session, completedAt: ctx.now() });
  }
}

/**
 * The user ended the session (✕ or "Back to home"): records session_completed, or
 * session_abandoned if cards were left (M4), then marks it completed. Once per session.
 */
export async function finishSession(
  ctx: AppContext,
  outcome: { reviewed: number; remaining: number; timeSpentMs: number },
): Promise<void> {
  const session = await getSession(ctx);
  if (!session || session.completedAt !== undefined) return;
  if (outcome.remaining > 0) {
    await recordEvent(ctx, 'session_abandoned', {
      reviewed: outcome.reviewed,
      remaining: outcome.remaining,
    });
  } else if (outcome.reviewed > 0) {
    await recordEvent(ctx, 'session_completed', {
      reviewed: outcome.reviewed,
      durationMs: Math.round(outcome.timeSpentMs),
    });
  }
  await completeSession(ctx);
}

export async function endSession(ctx: AppContext): Promise<void> {
  await setMeta(ctx.db, 'session', null);
}

export interface SessionSummary {
  reviewed: number;
  timeSpentMs: number;
}

/** This device's non-undone reviews since the session started. */
export async function sessionSummary(ctx: AppContext, session: Session): Promise<SessionSummary> {
  const deviceId = await getMeta(ctx.db, 'deviceId');
  const logs = await ctx.db.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(session.startedAt)
    .filter((log) => log.voidedAt === null && log.deviceId === deviceId)
    .toArray();
  return {
    reviewed: logs.length,
    timeSpentMs: logs.reduce((sum, log) => sum + log.durationMs, 0),
  };
}

/** How far ahead counts as "won’t come back for 2+ weeks". */
const FAR_OFF_MS = 14 * 86_400_000;

export interface SessionRecap {
  reviewed: number;
  /** Reviews not rated Again or, where the answer was checked (MCQ, typed cloze), correct. */
  remembered: number;
  /** Cards from this session the scheduler won’t show again for 2+ weeks. */
  farOff: number;
}

function remembered(log: { rating: number; outcome: Outcome | null }): boolean {
  const correct = log.outcome && 'correct' in log.outcome ? log.outcome.correct : null;
  return typeof correct === 'boolean' ? correct : log.rating !== 1;
}

/** The numbers on the session-complete screen (feel pass), from stored reviews and states. */
export async function sessionRecap(ctx: AppContext, session: Session): Promise<SessionRecap> {
  const deviceId = await getMeta(ctx.db, 'deviceId');
  const logs = await ctx.db.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(session.startedAt)
    .filter((log) => log.voidedAt === null && log.deviceId === deviceId)
    .toArray();
  const cardIds = [...new Set(logs.map((log) => log.cardId))];
  const states = await ctx.db.cardStates.bulkGet(cardIds);
  const horizon = ctx.now() + FAR_OFF_MS;
  return {
    reviewed: logs.length,
    remembered: logs.filter(remembered).length,
    farOff: states.filter((s) => s !== undefined && s.due >= horizon).length,
  };
}

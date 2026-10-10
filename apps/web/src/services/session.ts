import { studyDayKey } from '@recall/core';
import { getMeta, setMeta, type Session } from '../db/meta';
import type { AppContext } from './context';
import { effectiveTimeZone, getSettings } from './settings';

export async function getSession(ctx: AppContext): Promise<Session | null> {
  return (await getMeta(ctx.db, 'session')) ?? null;
}

/**
 * Starts a study session, or continues the stored one if it is for the same deck and
 * the same study day (so a reload mid-session picks up where it left off). The
 * session only marks a start time: which card comes next always comes from the
 * queue, so no other session state is needed for correctness.
 */
export async function startSession(
  ctx: AppContext,
  deckId: string | null,
  browserTimeZone: string,
): Promise<Session> {
  const settings = await getSettings(ctx);
  const tz = effectiveTimeZone(settings, browserTimeZone);
  const now = ctx.now();
  const existing = await getSession(ctx);
  if (
    existing &&
    existing.completedAt === undefined &&
    existing.deckId === deckId &&
    studyDayKey(existing.startedAt, tz, settings.rolloverHour) ===
      studyDayKey(now, tz, settings.rolloverHour)
  ) {
    return existing;
  }
  const session: Session = { startedAt: now, deckId };
  await setMeta(ctx.db, 'session', session);
  return session;
}

/** Marks the session finished (idempotent). Its summary can still be read. */
export async function completeSession(ctx: AppContext): Promise<void> {
  const session = await getSession(ctx);
  if (session && session.completedAt === undefined) {
    await setMeta(ctx.db, 'session', { ...session, completedAt: ctx.now() });
  }
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

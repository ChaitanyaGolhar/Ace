import { studyDayKey } from '@recall/core';
import { getMeta, setMeta } from '../db/meta';
import type { AppContext } from './context';
import { recordEvent } from './events';
import { effectiveTimeZone, getSettings } from './settings';

// Coming back after a break (feel pass, moment 3): Home says so, and offers a session
// of the 20 most overdue cards. The cap limits one session; it never touches the schedule.

/** No review for at least this many study days… */
export const BREAK_DAYS = 2;
/** …and more than this many cards due (reviews + learning). */
export const BREAK_MIN_DUE = 30;
/** "Start with 20". */
export const SESSION_CAP = 20;

export interface BreakReturn {
  /** Review + learning cards due now. */
  due: number;
  /** Study days since the last review (today counts as a day without one). */
  daysAway: number;
}

const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`) / 86_400_000;

/**
 * The break-return state, or null. `lastReviewAt` is the latest review that wasn't
 * undone; null (never reviewed) is a first visit, not a return.
 */
export function breakReturnFor(input: {
  lastReviewAt: number | null;
  now: number;
  timeZone: string;
  rolloverHour: number;
  due: number;
}): BreakReturn | null {
  const { lastReviewAt, now, timeZone, rolloverHour, due } = input;
  if (lastReviewAt === null || due <= BREAK_MIN_DUE) return null;
  const daysAway = Math.round(
    dayNumber(studyDayKey(now, timeZone, rolloverHour)) -
      dayNumber(studyDayKey(lastReviewAt, timeZone, rolloverHour)),
  );
  return daysAway >= BREAK_DAYS ? { due, daysAway } : null;
}

/** Records break_return_shown, at most once per study day. */
export async function noteBreakReturnShown(
  ctx: AppContext,
  shown: BreakReturn,
  browserTimeZone: string,
): Promise<void> {
  const settings = await getSettings(ctx);
  const day = studyDayKey(
    ctx.now(),
    effectiveTimeZone(settings, browserTimeZone),
    settings.rolloverHour,
  );
  const { db } = ctx;
  // One transaction, so two Home renders at once can't both record it.
  await db.transaction('rw', [db.meta, db.events], async () => {
    if ((await getMeta(db, 'breakReturnShownOn')) === day) return;
    await setMeta(db, 'breakReturnShownOn', day);
    await recordEvent(ctx, 'break_return_shown', {
      due: shown.due,
      daysAway: shown.daysAway,
    });
  });
}

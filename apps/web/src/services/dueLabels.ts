import { endOfStudyDay, studyDayKey, type CardState } from '@recall/core';

/** Whole study days from day key `a` to day key `b` ("2026-10-10" → "2026-10-13" = 3). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function spanLabel(days: number): string {
  if (days < 14) return `${String(days)} days`;
  if (days < 60) return `${String(Math.round(days / 7))} weeks`;
  return `${String(Math.round(days / 30.44))} months`;
}

/** Deck view: when a card is next due — "New", "Due today", "Tomorrow", "In 3 days"… */
export function cardDueLabel(
  state: Pick<CardState, 'state' | 'due'>,
  now: number,
  timeZone: string,
  rolloverHour: number,
): string {
  if (state.state === 'new') return 'New';
  if (state.due < endOfStudyDay(now, timeZone, rolloverHour)) return 'Due today';
  const days = dayDiff(
    studyDayKey(now, timeZone, rolloverHour),
    studyDayKey(state.due, timeZone, rolloverHour),
  );
  return days === 1 ? 'Tomorrow' : `In ${spanLabel(days)}`;
}

/** Deck view meta line: "last studied yesterday". Null if never studied. */
export function lastStudiedLabel(
  lastReviewedAt: number | null,
  now: number,
  timeZone: string,
  rolloverHour: number,
): string | null {
  if (lastReviewedAt === null) return null;
  const days = dayDiff(
    studyDayKey(lastReviewedAt, timeZone, rolloverHour),
    studyDayKey(now, timeZone, rolloverHour),
  );
  if (days <= 0) return 'last studied today';
  if (days === 1) return 'last studied yesterday';
  return `last studied ${spanLabel(days)} ago`;
}

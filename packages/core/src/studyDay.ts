// A "study day" runs from rolloverHour:00 local time to rolloverHour:00 the next
// local day (04:00 by default), so a late-night session counts toward the evening
// it started in. Time zones are IANA names ("Asia/Kolkata"); Intl does the
// time-zone maths, which is deterministic (it reads built-in tz data, not the clock).

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    // Throws RangeError for an unknown time zone.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23', // 0–23; avoids "24" for midnight
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Local wall-clock date and hour of an instant in a time zone. */
function localParts(at: number, timeZone: string) {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(at)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  const { year, month, day, hour } = parts;
  if (year === undefined || month === undefined || day === undefined || hour === undefined) {
    throw new Error(`Could not read local time in ${timeZone}`);
  }
  return { year, month, day, hour };
}

function assertRolloverHour(rolloverHour: number): void {
  if (!Number.isInteger(rolloverHour) || rolloverHour < 0 || rolloverHour > 23) {
    throw new RangeError(`rolloverHour must be an integer 0–23, got ${String(rolloverHour)}`);
  }
}

/**
 * The study day an instant belongs to, as "YYYY-MM-DD".
 *
 * It compares the *local wall-clock* hour with the rollover hour, rather than
 * subtracting hours from the instant, so it stays right on DST days (when a local
 * day is 23 or 25 hours long).
 */
export function studyDayKey(at: number, timeZone: string, rolloverHour: number): string {
  assertRolloverHour(rolloverHour);
  const { year, month, day, hour } = localParts(at, timeZone);
  // Before the rollover hour, we are still in the previous calendar day's study day.
  // Date.UTC normalises day 0 to the last day of the previous month (and year).
  const date = new Date(Date.UTC(year, month - 1, hour < rolloverHour ? day - 1 : day));
  return date.toISOString().slice(0, 10);
}

/**
 * The first instant (epoch ms) of the study day after the one containing `now`.
 * Cards due before this moment are "due today".
 *
 * Converting "tomorrow at 04:00 local" to an instant directly is fiddly: on DST days
 * that wall time can be ambiguous or not exist at all. Instead this binary-searches
 * for the moment `studyDayKey` changes. That works because the key never goes
 * backwards as time moves forward, and the next study day always starts within 48h.
 * About 28 steps, each a cached Intl call.
 */
export function endOfStudyDay(now: number, timeZone: string, rolloverHour: number): number {
  const today = studyDayKey(now, timeZone, rolloverHour);
  let lo = now; // invariant: still today
  let hi = now + 48 * 60 * 60 * 1000; // invariant: already a later day
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (studyDayKey(mid, timeZone, rolloverHour) === today) lo = mid;
    else hi = mid;
  }
  return hi;
}

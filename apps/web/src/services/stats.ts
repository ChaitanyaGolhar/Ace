import { computeStats, type StatsData } from '@recall/core';
import type { AppContext } from './context';
import { loadQueueInput } from './queue';

// Stats screen (brief §10, screen 7): the numbers come from core's computeStats; this file
// loads its input from Dexie and holds the screen's readout strings.

export type { StatsData } from '@recall/core';

export async function loadStats(
  ctx: AppContext,
  options: { browserTimeZone: string },
): Promise<StatsData> {
  return computeStats(await loadQueueInput(ctx, options.browserTimeZone));
}

/** "Sep 11" for a study-day key. */
export function shortDate(key: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${key}T12:00:00Z`));
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** Readout above the "Coming up" chart: "Today · 24 cards due". */
export function forecastReadout(entry: StatsData['forecast'][number]): string {
  return `${entry.label} · ${plural(entry.count, 'card')} due`;
}

/** Readout above the "Reviews per day" chart: "Today · 13 reviews", "Sep 30 · 1 review". */
export function perDayReadout(entry: StatsData['perDay'][number], isToday: boolean): string {
  return `${isToday ? 'Today' : shortDate(entry.day)} · ${plural(entry.count, 'review')}`;
}

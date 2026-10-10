import type { ReviewLog } from '@recall/core';

const SAMPLE_SIZE = 200;
const MIN_REVIEWS = 20;

/**
 * "About N minutes" on Home: the median time of the user's last 200 non-undone reviews,
 * times the number of cards to study, rounded to whole minutes (at least 1). Null when
 * there is too little history (fewer than 20 reviews) to say anything useful, or nothing
 * to study.
 */
export function estimateStudyMinutes(logs: readonly ReviewLog[], cardCount: number): number | null {
  if (cardCount <= 0) return null;
  const recent = logs
    .filter((l) => l.voidedAt === null)
    .sort((a, b) => b.reviewedAt - a.reviewedAt)
    .slice(0, SAMPLE_SIZE)
    .map((l) => l.durationMs)
    .sort((a, b) => a - b);
  if (recent.length < MIN_REVIEWS) return null;
  const mid = Math.floor(recent.length / 2);
  const median =
    recent.length % 2 === 1
      ? (recent[mid] ?? 0)
      : ((recent[mid - 1] ?? 0) + (recent[mid] ?? 0)) / 2;
  return Math.max(1, Math.round((median * cardCount) / 60_000));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short label for a rating button's next interval: "<1m", "10m", "5h", "3d", "2mo", "1.5y". */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return '<1m';
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${String(days)}d`;
  const months = Math.round(days / 30);
  if (days < 365 && months < 12) return `${String(months)}mo`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${String(years)}y`;
}

/** Time spent, e.g. "4s", "1m 5s", "1h 2m". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${String(totalMinutes)}m ${String(totalSeconds % 60)}s`;
  return `${String(Math.floor(totalMinutes / 60))}h ${String(totalMinutes % 60)}m`;
}

/** "1,014": counts shown to people, with thousands grouped. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

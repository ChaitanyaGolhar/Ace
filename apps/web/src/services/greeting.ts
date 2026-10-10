/** "Good morning." (05:00–11:59), "Good afternoon." (12:00–16:59), else "Good evening." */
export function greetingFor(now: number, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
  );
  if (hour >= 5 && hour < 12) return 'Good morning.';
  if (hour >= 12 && hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

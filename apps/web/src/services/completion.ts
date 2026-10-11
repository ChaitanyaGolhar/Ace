import type { NextDue } from './overview';

/** "You reviewed 4 cards in about 3 minutes." */
export function completionSentence(reviewed: number, timeSpentMs: number): string {
  const cards = `${String(reviewed)} card${reviewed === 1 ? '' : 's'}`;
  if (timeSpentMs < 60_000) return `You reviewed ${cards} in under a minute.`;
  const minutes = Math.round(timeSpentMs / 60_000);
  return `You reviewed ${cards} in about ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`;
}

/** "Remembered 7 of 8". */
export function rememberedLine(remembered: number, reviewed: number): string {
  return `Remembered ${String(remembered)} of ${String(reviewed)}`;
}

/** "3 cards won’t come back for 2+ weeks." Only when it's true (null for 0). */
export function farOffLine(count: number): string | null {
  if (count === 0) return null;
  return `${String(count)} card${count === 1 ? '' : 's'} won’t come back for 2+ weeks.`;
}

/** "Next: 9 due tomorrow", "Next: 3 due on Thu 15 Oct"… */
export function nextDueLine(next: NextDue): string {
  switch (next.kind) {
    case 'none':
      return 'Next: nothing scheduled yet';
    case 'dueToday':
      return `Next: ${String(next.count)} still due today`;
    case 'laterToday':
      return `Next: ${String(next.count)} due later today`;
    case 'tomorrow':
      return `Next: ${String(next.count)} due tomorrow`;
    case 'later': {
      const day = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${next.day}T12:00:00Z`));
      return `Next: ${String(next.count)} due on ${day}`;
    }
  }
}

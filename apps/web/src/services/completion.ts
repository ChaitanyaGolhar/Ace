import type { NextDue } from './overview';

/** "You reviewed 4 cards in about 3 minutes." */
export function completionSentence(reviewed: number, timeSpentMs: number): string {
  const cards = `${String(reviewed)} card${reviewed === 1 ? '' : 's'}`;
  if (timeSpentMs < 60_000) return `You reviewed ${cards} in under a minute.`;
  const minutes = Math.round(timeSpentMs / 60_000);
  return `You reviewed ${cards} in about ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`;
}

/** Value for the "Next cards due" row: "9 tomorrow", "3 on Thu 15 Oct"… */
export function nextDueValue(next: NextDue): string {
  switch (next.kind) {
    case 'none':
      return 'None scheduled yet';
    case 'laterToday':
      return `${String(next.count)} later today`;
    case 'tomorrow':
      return `${String(next.count)} tomorrow`;
    case 'later': {
      const day = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${next.day}T12:00:00Z`));
      return `${String(next.count)} on ${day}`;
    }
  }
}

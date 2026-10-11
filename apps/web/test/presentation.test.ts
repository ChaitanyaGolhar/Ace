import { describe, expect, it } from 'vitest';
import type { ReviewLog } from '@recall/core';
import { resolveTheme } from '../src/services/theme';
import { greetingFor } from '../src/services/greeting';
import { estimateStudyMinutes } from '../src/services/estimate';
import { cardDueLabel, lastStudiedLabel } from '../src/services/dueLabels';
import { relativeTime, syncStatusView } from '../src/services/syncStatus';
import { completionSentence, nextDueLine } from '../src/services/completion';
import { DAY, HOUR, MINUTE } from './helpers';

const TZ = 'Asia/Kolkata';
/** 2026-10-10 15:30 IST */
const NOW = Date.parse('2026-10-10T10:00:00Z');
const ist = (isoLocal: string) => Date.parse(`${isoLocal}+05:30`);

describe('resolveTheme', () => {
  it('follows the system preference for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('uses an explicit choice as-is', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('greetingFor', () => {
  it.each([
    ['2026-10-10T04:59', 'Good evening.'],
    ['2026-10-10T05:00', 'Good morning.'],
    ['2026-10-10T11:59', 'Good morning.'],
    ['2026-10-10T12:00', 'Good afternoon.'],
    ['2026-10-10T16:59', 'Good afternoon.'],
    ['2026-10-10T17:00', 'Good evening.'],
    ['2026-10-10T23:30', 'Good evening.'],
  ])('%s local → %s', (local, greeting) => {
    expect(greetingFor(ist(local), TZ)).toBe(greeting);
  });
});

describe('estimateStudyMinutes', () => {
  const log = (i: number, durationMs: number, voided = false): ReviewLog => ({
    id: `01920000-0000-7000-8000-${i.toString(16).padStart(12, '0')}`,
    cardId: '01920000-0000-7000-8000-000000000001',
    rating: 3,
    reviewedAt: NOW - DAY + i * MINUTE,
    durationMs,
    deviceId: 'd',
    voidedAt: voided ? NOW : null,
    outcome: null,
  });

  it('is null with fewer than 20 reviews', () => {
    const logs = Array.from({ length: 19 }, (_, i) => log(i + 1, 6000));
    expect(estimateStudyMinutes(logs, 10)).toBeNull();
  });

  it('is the median review time × cards due, rounded to whole minutes', () => {
    // 21 reviews: median of 1..21 seconds = 11 s. 30 cards × 11 s = 5.5 min → 6.
    const logs = Array.from({ length: 21 }, (_, i) => log(i + 1, (i + 1) * 1000));
    expect(estimateStudyMinutes(logs, 30)).toBe(6);
  });

  it('averages the two middle values for an even count', () => {
    // 20 reviews: 1..20 s → median 10.5 s. 40 cards → 7 min.
    const logs = Array.from({ length: 20 }, (_, i) => log(i + 1, (i + 1) * 1000));
    expect(estimateStudyMinutes(logs, 40)).toBe(7);
  });

  it('uses only the last 200 reviews and ignores undone ones', () => {
    const old = Array.from({ length: 300 }, (_, i) => log(i + 1, 600_000)); // 10 min each
    const recent = Array.from({ length: 200 }, (_, i) => log(1000 + i, 6000)); // 6 s each
    const voided = Array.from({ length: 50 }, (_, i) => log(2000 + i, 900_000, true));
    expect(estimateStudyMinutes([...voided, ...recent, ...old], 10)).toBe(1);
  });

  it('never says 0 minutes when there is something to study', () => {
    const logs = Array.from({ length: 20 }, (_, i) => log(i + 1, 1000));
    expect(estimateStudyMinutes(logs, 2)).toBe(1);
  });

  it('is null when nothing is due', () => {
    const logs = Array.from({ length: 20 }, (_, i) => log(i + 1, 1000));
    expect(estimateStudyMinutes(logs, 0)).toBeNull();
  });
});

describe('cardDueLabel', () => {
  const at = (state: 'new' | 'learning' | 'review' | 'relearning', due: number) =>
    cardDueLabel({ state, due }, NOW, TZ, 4);

  it('labels new cards "New"', () => {
    expect(at('new', NOW)).toBe('New');
  });
  it('anything due before the next rollover is "Due today" (incl. overdue)', () => {
    expect(at('review', NOW - 3 * DAY)).toBe('Due today');
    expect(at('review', ist('2026-10-11T03:59'))).toBe('Due today');
    expect(at('learning', NOW + 10 * MINUTE)).toBe('Due today');
  });
  it('the next study day is "Tomorrow"', () => {
    expect(at('review', ist('2026-10-11T04:00'))).toBe('Tomorrow');
    expect(at('review', ist('2026-10-12T03:00'))).toBe('Tomorrow');
  });
  it('then days, weeks, months', () => {
    expect(at('review', ist('2026-10-13T09:00'))).toBe('In 3 days');
    expect(at('review', ist('2026-10-23T09:00'))).toBe('In 13 days');
    expect(at('review', ist('2026-10-24T09:00'))).toBe('In 2 weeks');
    expect(at('review', ist('2026-12-01T09:00'))).toBe('In 7 weeks');
    expect(at('review', ist('2026-12-20T09:00'))).toBe('In 2 months');
    expect(at('review', ist('2027-12-20T09:00'))).toBe('In 14 months');
  });
});

describe('lastStudiedLabel', () => {
  const label = (t: number | null) => lastStudiedLabel(t, NOW, TZ, 4);
  it('is null if never studied', () => {
    expect(label(null)).toBeNull();
  });
  it('today / yesterday / N days ago, by study day', () => {
    expect(label(ist('2026-10-10T04:00'))).toBe('last studied today');
    expect(label(ist('2026-10-10T03:59'))).toBe('last studied yesterday');
    expect(label(ist('2026-10-07T20:00'))).toBe('last studied 3 days ago');
    expect(label(ist('2026-09-20T20:00'))).toBe('last studied 3 weeks ago');
  });
});

describe('sync status copy (icon + words, never colour alone)', () => {
  it('relativeTime', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * MINUTE, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3 h ago');
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe('2 d ago');
  });

  it('maps every state to an icon name and words', () => {
    expect(syncStatusView({ kind: 'synced', at: NOW - 10_000 }, NOW)).toEqual({
      icon: 'synced',
      text: 'Synced · just now',
      action: null,
    });
    expect(syncStatusView({ kind: 'syncing' }, NOW)).toEqual({
      icon: 'syncing',
      text: 'Syncing…',
      action: null,
    });
    expect(syncStatusView({ kind: 'offline' }, NOW)).toEqual({
      icon: 'offline',
      text: 'Offline · saved on this device',
      action: null,
    });
    expect(syncStatusView({ kind: 'error' }, NOW)).toEqual({
      icon: 'error',
      text: 'Couldn’t sync · retrying',
      action: null,
    });
    expect(syncStatusView({ kind: 'signedOut' }, NOW)).toEqual({
      icon: 'signedOut',
      text: 'On this device only',
      action: 'Sign in to sync',
    });
  });
});

describe('review completion copy', () => {
  it('completionSentence', () => {
    expect(completionSentence(4, 3 * MINUTE + 10_000)).toBe(
      'You reviewed 4 cards in about 3 minutes.',
    );
    expect(completionSentence(1, 20_000)).toBe('You reviewed 1 card in under a minute.');
    expect(completionSentence(2, 70_000)).toBe('You reviewed 2 cards in about 1 minute.');
  });

  it('nextDueLine (feel pass: "Next: N due tomorrow")', () => {
    expect(nextDueLine({ kind: 'tomorrow', count: 9 })).toBe('Next: 9 due tomorrow');
    expect(nextDueLine({ kind: 'laterToday', count: 1 })).toBe('Next: 1 due later today');
    expect(nextDueLine({ kind: 'none' })).toBe('Next: nothing scheduled yet');
    expect(nextDueLine({ kind: 'later', day: '2026-10-15', count: 3 })).toMatch(
      /^Next: 3 due on Thu,? 15 Oct$/,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { toStatsViewModel } from '../src/features/stats/useStats';
import { hourLabel } from '../src/features/settings/useSettingsScreen';
import { decksNote } from '../src/features/signin/useSignIn';
import type { StatsData } from '../src/services/stats';

const data: StatsData = {
  retention: { percent: 91, reviews: 120 },
  reviews: 372,
  daysStudied: 24,
  averagePerStudiedDay: 16,
  perDay: Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 8, 11 + i)).toISOString().slice(0, 10),
    count: i % 5 === 0 ? 0 : i,
  })),
  forecast: [
    { day: '2026-10-10', label: 'Today', count: 24 },
    { day: '2026-10-11', label: 'Sun', count: 6 },
    { day: '2026-10-12', label: 'Mon', count: 12 },
    { day: '2026-10-13', label: 'Tue', count: 0 },
    { day: '2026-10-14', label: 'Wed', count: 8 },
    { day: '2026-10-15', label: 'Thu', count: 18 },
    { day: '2026-10-16', label: 'Fri', count: 4 },
  ],
  cardsByState: { learned: 102, learning: 6, notSeen: 48 },
};

describe('toStatsViewModel', () => {
  const vm = toStatsViewModel(data, 0, 29);

  it('tiles show the numbers from the stats functions', () => {
    expect(vm.retention.value).toBe('91%');
    expect(vm.reviews).toEqual({ value: '372', caption: 'About 16 a day on days you studied' });
    expect(vm.daysStudied).toMatchObject({ value: '24', of: 'of 30' });
  });

  it('bars are scaled to the largest value; zero bars get the stub', () => {
    expect(vm.forecast.bars[0]).toMatchObject({ height: 1, isToday: true, axis: 'Today' });
    expect(vm.forecast.bars[3]?.height).toBe(0);
    expect(vm.forecast.bars[1]?.height).toBeCloseTo(6 / 24);
    expect(vm.perDay.bars).toHaveLength(30);
    expect(vm.perDay.bars[29]).toMatchObject({ isToday: true, label: 'Today · 29 reviews' });
    expect(vm.perDay.bars[0]?.height).toBe(0);
  });

  it('readouts default to today and follow the focused bar', () => {
    expect(vm.forecast.readout).toBe('Today · 24 cards due');
    expect(vm.perDay.readout).toBe('Today · 29 reviews');
    const focused = toStatsViewModel(data, 1, 1);
    expect(focused.forecast.readout).toBe('Sun · 6 cards due');
    expect(focused.perDay.readout).toBe('Sep 12 · 1 review');
  });

  it('axis dates: first day, middle day, Today', () => {
    expect(vm.perDay.axis).toEqual(['Sep 11', 'Sep 25', 'Today']);
  });

  it('retention without any review-state reviews shows a dash, not 0%', () => {
    const none = toStatsViewModel(
      { ...data, retention: { percent: null, reviews: 0 }, averagePerStudiedDay: null, reviews: 0 },
      0,
      29,
    );
    expect(none.retention.value).toBe('—');
    expect(none.reviews.caption).toBe('No reviews in the last 30 days');
  });

  it('your cards rows', () => {
    expect(vm.cards).toEqual([
      { label: 'Learned · in regular review', count: 102 },
      { label: 'Still learning', count: 6 },
      { label: 'Not seen yet', count: 48 },
    ]);
  });
});

describe('settings and sign-in copy helpers', () => {
  it('hourLabel', () => {
    expect(hourLabel(0)).toBe('12:00 AM');
    expect(hourLabel(4)).toBe('4:00 AM');
    expect(hourLabel(12)).toBe('12:00 PM');
    expect(hourLabel(18)).toBe('6:00 PM');
  });

  it('decksNote uses the real deck count', () => {
    expect(decksNote(0)).toBeNull();
    expect(decksNote(1)).toMatch(/^The 1 deck on this device stays as it is\./);
    expect(decksNote(3)).toMatch(/^The 3 decks on this device stay as they are\./);
  });
});

import { describe, expect, it } from 'vitest';
import { forecastReadout, perDayReadout, shortDate } from '../src/services/stats';

// computeStats itself lives in packages/core (test/stats.test.ts); these are the
// screen's readout strings.

describe('stats readouts (bar hover/focus line)', () => {
  it('forecast readout', () => {
    expect(forecastReadout({ day: '2026-10-10', label: 'Today', count: 24 })).toBe(
      'Today · 24 cards due',
    );
    expect(forecastReadout({ day: '2026-10-11', label: 'Sun', count: 1 })).toBe('Sun · 1 card due');
  });

  it('reviews-per-day readout and axis dates', () => {
    expect(perDayReadout({ day: '2026-10-10', count: 13 }, true)).toBe('Today · 13 reviews');
    expect(perDayReadout({ day: '2026-09-30', count: 1 }, false)).toBe('Sep 30 · 1 review');
    expect(shortDate('2026-09-11')).toBe('Sep 11');
  });
});

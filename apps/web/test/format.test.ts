import { describe, expect, it } from 'vitest';
import { formatDuration, formatInterval } from '../src/services/format';
import { DAY, HOUR, MINUTE } from './helpers';

describe('formatInterval (rating button labels)', () => {
  it.each([
    [0, '<1m'],
    [59_000, '<1m'],
    [MINUTE, '1m'],
    [6 * MINUTE, '6m'],
    [10 * MINUTE, '10m'],
    [59 * MINUTE + 29_000, '59m'],
    [HOUR, '1h'],
    [5 * HOUR + 20 * MINUTE, '5h'],
    [DAY, '1d'],
    [3 * DAY, '3d'],
    [29 * DAY, '29d'],
    [30 * DAY, '1mo'],
    [95 * DAY, '3mo'],
    [365 * DAY, '1y'],
    [548 * DAY, '1.5y'],
    [3650 * DAY, '10y'],
  ])('%d ms → %s', (ms, label) => {
    expect(formatInterval(ms)).toBe(label);
  });
});

describe('formatDuration (time spent)', () => {
  it.each([
    [0, '0s'],
    [4_400, '4s'],
    [65_000, '1m 5s'],
    [HOUR + 2 * MINUTE, '1h 2m'],
  ])('%d ms → %s', (ms, label) => {
    expect(formatDuration(ms)).toBe(label);
  });
});

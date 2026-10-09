import { describe, expect, it } from 'vitest';
import { endOfStudyDay, studyDayKey } from '../src';
import { HOUR, MINUTE } from './helpers/fixtures';
import { pick, randomInt, seededRandom } from './helpers/random';

const KOLKATA = 'Asia/Kolkata'; // UTC+5:30, no DST
const NEW_YORK = 'America/New_York'; // DST: 2026-03-08 02:00 EST → 03:00 EDT; 2026-11-01 02:00 EDT → 01:00 EST
const utc = (iso: string) => Date.parse(iso);

describe('studyDayKey', () => {
  it('puts 03:59 and 04:00 local on different study days (Asia/Kolkata)', () => {
    // 03:59 IST on 10 Oct is 22:29Z on 9 Oct.
    expect(studyDayKey(utc('2026-10-09T22:29:00Z'), KOLKATA, 4)).toBe('2026-10-09');
    expect(studyDayKey(utc('2026-10-09T22:30:00Z'), KOLKATA, 4)).toBe('2026-10-10');
    expect(studyDayKey(utc('2026-10-09T22:29:59.999Z'), KOLKATA, 4)).toBe('2026-10-09');
  });

  it('handles New York across the March DST switch', () => {
    // Day before the switch: 04:00 EST = 09:00Z.
    expect(studyDayKey(utc('2026-03-07T08:59:00Z'), NEW_YORK, 4)).toBe('2026-03-06');
    expect(studyDayKey(utc('2026-03-07T09:00:00Z'), NEW_YORK, 4)).toBe('2026-03-07');
    // Day of the switch: 04:00 EDT = 08:00Z.
    expect(studyDayKey(utc('2026-03-08T07:59:00Z'), NEW_YORK, 4)).toBe('2026-03-07');
    expect(studyDayKey(utc('2026-03-08T08:00:00Z'), NEW_YORK, 4)).toBe('2026-03-08');
  });

  it('handles New York across the November DST switch', () => {
    // 04:00 EST on 1 Nov = 09:00Z. 01:30 happens twice that night; both are still 31 Oct.
    expect(studyDayKey(utc('2026-11-01T05:30:00Z'), NEW_YORK, 4)).toBe('2026-10-31'); // 01:30 EDT
    expect(studyDayKey(utc('2026-11-01T06:30:00Z'), NEW_YORK, 4)).toBe('2026-10-31'); // 01:30 EST
    expect(studyDayKey(utc('2026-11-01T08:59:00Z'), NEW_YORK, 4)).toBe('2026-10-31');
    expect(studyDayKey(utc('2026-11-01T09:00:00Z'), NEW_YORK, 4)).toBe('2026-11-01');
  });

  it('with rollover hour 0 is the plain local calendar date', () => {
    expect(studyDayKey(utc('2026-10-10T18:29:00Z'), KOLKATA, 0)).toBe('2026-10-10'); // 23:59 IST
    expect(studyDayKey(utc('2026-10-10T18:30:00Z'), KOLKATA, 0)).toBe('2026-10-11'); // 00:00 IST
  });

  it('rolls back across month and year boundaries', () => {
    expect(studyDayKey(utc('2026-01-01T03:00:00Z'), 'UTC', 4)).toBe('2025-12-31');
    expect(studyDayKey(utc('2026-03-01T03:00:00Z'), 'UTC', 4)).toBe('2026-02-28');
  });

  it('rejects an invalid rollover hour or time zone', () => {
    for (const hour of [-1, 24, 1.5, Number.NaN]) {
      expect(() => studyDayKey(0, 'UTC', hour)).toThrow(RangeError);
    }
    expect(() => studyDayKey(0, 'Not/AZone', 4)).toThrow(RangeError);
  });
});

describe('endOfStudyDay', () => {
  it('is the next rollover after now (Asia/Kolkata)', () => {
    // Noon IST on 10 Oct → 04:00 IST on 11 Oct = 22:30Z on 10 Oct.
    expect(endOfStudyDay(utc('2026-10-10T06:30:00Z'), KOLKATA, 4)).toBe(
      utc('2026-10-10T22:30:00Z'),
    );
  });

  it('before the rollover hour, ends at the rollover on the same calendar date', () => {
    // 02:00 IST on 10 Oct still belongs to 9 Oct, which ends at 04:00 IST on 10 Oct.
    expect(endOfStudyDay(utc('2026-10-09T20:30:00Z'), KOLKATA, 4)).toBe(
      utc('2026-10-09T22:30:00Z'),
    );
  });

  it('exactly at the rollover, the new day has just started and ends a day later', () => {
    expect(endOfStudyDay(utc('2026-10-09T22:30:00Z'), KOLKATA, 4)).toBe(
      utc('2026-10-10T22:30:00Z'),
    );
  });

  it('is 23 hours after the start on the March DST day in New York', () => {
    expect(endOfStudyDay(utc('2026-03-07T17:00:00Z'), NEW_YORK, 4)).toBe(
      utc('2026-03-08T08:00:00Z'),
    );
  });

  it('is 25 hours after the start on the November DST day in New York', () => {
    expect(endOfStudyDay(utc('2026-10-31T16:00:00Z'), NEW_YORK, 4)).toBe(
      utc('2026-11-01T09:00:00Z'),
    );
  });

  it('when the rollover hour does not exist (DST gap), ends when the clocks jump', () => {
    // 02:00 on 8 March never happens in New York; 01:59:59 EST is followed by 03:00 EDT.
    expect(endOfStudyDay(utc('2026-03-07T17:00:00Z'), NEW_YORK, 2)).toBe(
      utc('2026-03-08T07:00:00Z'),
    );
  });

  it('is always the first instant of the next study day (seeded property test)', () => {
    const rand = seededRandom(7);
    const zones = [
      KOLKATA,
      NEW_YORK,
      'Europe/London',
      'Australia/Lord_Howe',
      'Pacific/Apia',
      'UTC',
    ];
    const start = utc('2025-01-01T00:00:00Z');
    for (let i = 0; i < 300; i++) {
      const zone = pick(rand, zones);
      const hour = randomInt(rand, 0, 23);
      const now =
        start + randomInt(rand, 0, 2 * 365 * 24 * 60) * MINUTE + randomInt(rand, 0, 59_999);
      const end = endOfStudyDay(now, zone, hour);
      const today = studyDayKey(now, zone, hour);
      expect(end).toBeGreaterThan(now);
      expect(end - now).toBeLessThanOrEqual(25 * HOUR);
      expect(studyDayKey(end - 1, zone, hour)).toBe(today);
      expect(studyDayKey(end, zone, hour)).not.toBe(today);
    }
  });
});

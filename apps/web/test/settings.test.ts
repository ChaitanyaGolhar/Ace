import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  effectiveTimeZone,
  getSettings,
  updateSettings,
} from '../src/services/settings';
import { makeTestContext } from './helpers';

describe('settings', () => {
  it('defaults: 20 new cards/day, 04:00 rollover, browser time zone, system theme', async () => {
    const ctx = makeTestContext();
    expect(await getSettings(ctx)).toEqual({
      newPerDay: 20,
      rolloverHour: 4,
      timeZone: null,
      theme: 'system',
    });
    expect(DEFAULT_SETTINGS.newPerDay).toBe(20);
  });

  it('updates and persists a partial change', async () => {
    const ctx = makeTestContext();
    await updateSettings(ctx, { newPerDay: 5, theme: 'dark' });
    expect(await getSettings(ctx)).toEqual({ ...DEFAULT_SETTINGS, newPerDay: 5, theme: 'dark' });
  });

  it.each([
    { newPerDay: -1 },
    { newPerDay: 2.5 },
    { newPerDay: 10_000 },
    { rolloverHour: 24 },
    { rolloverHour: -1 },
    { timeZone: 'Mars/Olympus_Mons' },
  ])('rejects an invalid value %o and keeps the old settings', async (patch) => {
    const ctx = makeTestContext();
    await expect(updateSettings(ctx, patch)).rejects.toThrow();
    expect(await getSettings(ctx)).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts a valid IANA time zone', async () => {
    const ctx = makeTestContext();
    await updateSettings(ctx, { timeZone: 'Asia/Kolkata' });
    expect((await getSettings(ctx)).timeZone).toBe('Asia/Kolkata');
  });

  it('effectiveTimeZone falls back to the browser time zone', () => {
    expect(effectiveTimeZone({ ...DEFAULT_SETTINGS, timeZone: null }, 'Europe/Paris')).toBe(
      'Europe/Paris',
    );
    expect(
      effectiveTimeZone({ ...DEFAULT_SETTINGS, timeZone: 'Asia/Kolkata' }, 'Europe/Paris'),
    ).toBe('Asia/Kolkata');
  });
});

import { z } from 'zod';
import { getMeta, setMeta, type Settings } from '../db/meta';
import type { AppContext } from './context';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  newPerDay: 20,
  rolloverHour: 4,
  timeZone: null,
  theme: 'system',
});

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const SettingsSchema = z.object({
  newPerDay: z.int().min(0).max(9999),
  rolloverHour: z.int().min(0).max(23),
  timeZone: z.string().refine(isValidTimeZone, 'Unknown time zone').nullable(),
  theme: z.enum(['system', 'light', 'dark']),
});

export async function getSettings(ctx: AppContext): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await getMeta(ctx.db, 'settings')) };
}

/** Validates the merged result; on an invalid value it throws and stores nothing. */
export async function updateSettings(ctx: AppContext, patch: Partial<Settings>): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings(ctx)), ...patch });
  await setMeta(ctx.db, 'settings', next);
  return next;
}

export function effectiveTimeZone(settings: Settings, browserTimeZone: string): string {
  return settings.timeZone ?? browserTimeZone;
}

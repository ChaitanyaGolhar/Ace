import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { getMeta, type StoragePersistence, type Theme } from '../../db/meta';
import { effectiveTimeZone, getSettings, updateSettings } from '../../services/settings';

export interface SettingsViewModel {
  status: 'loading' | 'error' | 'ready';
  /** Form values (strings, as typed). */
  newPerDay: string;
  rolloverHour: number;
  theme: Theme;
  /** The time zone in use (the browser's unless changed). */
  timeZone: string;
  storagePersistence: StoragePersistence | null;
  saving: boolean;
  error: string | null;
  /** "Settings saved" after a successful save. */
  savedMessage: string | null;
  setNewPerDay: (v: string) => void;
  setRolloverHour: (v: number) => void;
  setTheme: (v: Theme) => void;
  save: () => void;
}

export function useSettingsScreen(): SettingsViewModel {
  const { ctx, browserTimeZone } = useServices();
  const query = useQuery(async () => {
    const settings = await getSettings(ctx);
    const storagePersistence = (await getMeta(ctx.db, 'storagePersistence')) ?? null;
    return { settings, storagePersistence };
  }, [ctx]);

  const [form, setForm] = useState<{
    newPerDay: string;
    rolloverHour: number;
    theme: Theme;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const loaded = query.status === 'ready' ? query.data : null;
  useEffect(() => {
    // Fill the form once, from the stored settings.
    if (loaded && form === null) {
      setForm({
        newPerDay: String(loaded.settings.newPerDay),
        rolloverHour: loaded.settings.rolloverHour,
        theme: loaded.settings.theme,
      });
    }
  }, [loaded, form]);

  const edit = (patch: Partial<NonNullable<typeof form>>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setError(null);
    setSavedMessage(null);
  };

  const base = {
    newPerDay: form?.newPerDay ?? '',
    rolloverHour: form?.rolloverHour ?? 4,
    theme: form?.theme ?? 'system',
    timeZone: loaded ? effectiveTimeZone(loaded.settings, browserTimeZone) : browserTimeZone,
    storagePersistence: loaded?.storagePersistence ?? null,
    saving,
    error,
    savedMessage,
    setNewPerDay: (v: string) => {
      edit({ newPerDay: v });
    },
    setRolloverHour: (v: number) => {
      edit({ rolloverHour: v });
    },
    setTheme: (v: Theme) => {
      edit({ theme: v });
    },
    save: () => {
      if (!form || saving) return;
      const newPerDay = Number(form.newPerDay);
      if (
        form.newPerDay.trim() === '' ||
        !Number.isInteger(newPerDay) ||
        newPerDay < 0 ||
        newPerDay > 9999
      ) {
        setError('New cards per day must be a whole number from 0 to 9999.');
        return;
      }
      setSaving(true);
      updateSettings(ctx, { newPerDay, rolloverHour: form.rolloverHour, theme: form.theme })
        .then(() => {
          setSavedMessage('Settings saved');
        })
        .catch(() => {
          setError('Couldn’t save settings.');
        })
        .finally(() => {
          setSaving(false);
        });
    },
  };

  if (query.status === 'error') return { ...base, status: 'error' };
  if (!loaded || form === null) return { ...base, status: 'loading' };
  return { ...base, status: 'ready' };
}

import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { useToasts } from '../../app/toasts';
import { useQuery } from '../../app/useQuery';
import { getMeta, type StoragePersistence, type Theme } from '../../db/meta';
import { BackupError, exportBackup, importBackup } from '../../services/backup';
import { getSettings, updateSettings } from '../../services/settings';
import type { SyncStatusView } from '../../services/syncStatus';
import { useSyncStatus } from '../shell/useSyncStatus';
import { useSearchParams } from 'react-router';

export interface SettingsViewModel {
  status: 'loading' | 'error' | 'ready';
  /** The stepper's text (may be mid-edit). */
  newPerDayText: string;
  rolloverHour: number;
  /** "New day starts at" choices: 00:00–06:00, plus the current value if later. */
  rolloverOptions: { value: number; label: string }[];
  theme: Theme;
  storagePersistence: StoragePersistence | null;
  /** Account & sync. Cached in meta, so it is known offline (§9.1). */
  signedIn: boolean;
  email: string | null;
  sync: SyncStatusView;
  syncing: boolean;
  /** The magic link that brought the user back didn't work (?signInError=invalid). */
  signInError: string | null;
  /** "Ace 0.1 · Scheduling by FSRS" */
  versionLine: string;
  error: string | null;
  busy: boolean;
  setNewPerDayText: (v: string) => void;
  commitNewPerDay: () => void;
  stepNewPerDay: (delta: 1 | -1) => void;
  setRolloverHour: (v: number) => void;
  setTheme: (v: Theme) => void;
  syncNow: () => void;
  signOut: () => void;
  exportBackup: () => void;
  importBackup: (file: File) => void;
}

const MAX_NEW_PER_DAY = 9999;

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(h12)}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

function majorMinor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

export function useSettingsScreen(): SettingsViewModel {
  const { ctx, sync: engine } = useServices();
  const toasts = useToasts();
  const sync = useSyncStatus();
  const [params] = useSearchParams();
  const query = useQuery(async () => {
    const settings = await getSettings(ctx);
    const storagePersistence = (await getMeta(ctx.db, 'storagePersistence')) ?? null;
    const auth = (await getMeta(ctx.db, 'auth')) ?? { signedIn: false, email: null };
    return { settings, storagePersistence, auth };
  }, [ctx]);
  const loaded = query.status === 'ready' ? query.data : null;

  const [newPerDayText, setNewPerDayText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the stepper text in step with the stored value unless the user is typing.
  const stored = loaded?.settings.newPerDay;
  useEffect(() => {
    if (stored !== undefined) setNewPerDayText(String(stored));
  }, [stored]);

  const save = (patch: Parameters<typeof updateSettings>[1]) => {
    setError(null);
    updateSettings(ctx, patch).catch(() => {
      setError('Couldn’t save that setting.');
    });
  };

  const commitNewPerDay = () => {
    const text = (newPerDayText ?? '').trim();
    const n = Number(text);
    if (text === '' || !Number.isInteger(n) || n < 0 || n > MAX_NEW_PER_DAY) {
      setError('New cards per day must be a whole number from 0 to 9999.');
      return;
    }
    save({ newPerDay: n });
  };

  const rolloverHour = loaded?.settings.rolloverHour ?? 4;
  const hours = Array.from({ length: 7 }, (_, h) => h);
  if (!hours.includes(rolloverHour)) hours.push(rolloverHour);

  const base = {
    newPerDayText: newPerDayText ?? '',
    rolloverHour,
    rolloverOptions: hours.map((h) => ({ value: h, label: hourLabel(h) })),
    theme: loaded?.settings.theme ?? 'system',
    storagePersistence: loaded?.storagePersistence ?? null,
    signedIn: loaded?.auth.signedIn ?? false,
    email: loaded?.auth.email ?? null,
    sync,
    syncing: sync.icon === 'syncing',
    signInError:
      params.get('signInError') === null
        ? null
        : 'That sign-in link didn’t work. It may have expired or already been used. Send a new one.',
    versionLine: `Ace ${majorMinor(__APP_VERSION__)} · Scheduling by FSRS`,
    error,
    busy,
    setNewPerDayText: (v: string) => {
      setNewPerDayText(v);
      setError(null);
    },
    commitNewPerDay,
    stepNewPerDay: (delta: 1 | -1) => {
      const current = loaded?.settings.newPerDay ?? 0;
      const next = Math.min(MAX_NEW_PER_DAY, Math.max(0, current + delta));
      setNewPerDayText(String(next));
      save({ newPerDay: next });
    },
    setRolloverHour: (v: number) => {
      save({ rolloverHour: v });
    },
    setTheme: (v: Theme) => {
      save({ theme: v });
    },
    syncNow: () => {
      void engine.requestSync();
    },
    signOut: () => {
      void engine.signOut();
    },
    exportBackup: () => {
      setBusy(true);
      exportBackup(ctx)
        .then((backup) => {
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `recall-backup-${new Date(backup.exportedAt).toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch(() => {
          setError('Couldn’t export a backup.');
        })
        .finally(() => {
          setBusy(false);
        });
    },
    importBackup: (file: File) => {
      setBusy(true);
      setError(null);
      file
        .text()
        .then((text) => {
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            throw new BackupError('This file isn’t a valid backup, so nothing was imported.');
          }
          return importBackup(ctx, data);
        })
        .then((result) => {
          const changed = result.decks + result.cards + result.reviewLogs;
          toasts.show({
            message:
              changed === 0
                ? 'Backup imported. Everything was already here.'
                : 'Backup imported and merged.',
          });
        })
        .catch((e: unknown) => {
          setError(e instanceof BackupError ? e.message : 'Couldn’t import that backup.');
        })
        .finally(() => {
          setBusy(false);
        });
    },
  };

  if (query.status === 'error') return { ...base, status: 'error' };
  if (!loaded) return { ...base, status: 'loading' };
  return { ...base, status: 'ready' };
}

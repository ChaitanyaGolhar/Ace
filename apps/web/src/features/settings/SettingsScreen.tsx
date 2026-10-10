import type { Theme } from '../../db/meta';
import { ErrorMessage, Loading } from '../shell/states';
import { useSettingsScreen } from './useSettingsScreen';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const PERSISTENCE_TEXT = {
  granted: 'Persistent: the browser won’t clear your cards to free up space.',
  denied: 'Not persistent: the browser may clear your cards if the device runs low on space.',
  unsupported: 'This browser can’t make storage persistent.',
} as const;

export function SettingsScreen() {
  const vm = useSettingsScreen();

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;

  return (
    <section aria-labelledby="settings-title" className="flex flex-col gap-6">
      <h1 id="settings-title" className="text-2xl font-bold">
        Settings
      </h1>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          vm.save();
        }}
      >
        <h2 className="text-xl font-bold">Study</h2>
        <label className="flex flex-col gap-1">
          New cards per day
          <input
            className="field"
            type="number"
            inputMode="numeric"
            min={0}
            max={9999}
            step={1}
            value={vm.newPerDay}
            onChange={(e) => {
              vm.setNewPerDay(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          New day starts at
          <select
            className="field"
            value={vm.rolloverHour}
            onChange={(e) => {
              vm.setRolloverHour(Number(e.target.value));
            }}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <p>Time zone: {vm.timeZone}</p>

        <fieldset className="flex flex-col gap-1">
          <legend>Theme</legend>
          {THEMES.map((t) => (
            <label key={t.value} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="theme"
                value={t.value}
                checked={vm.theme === t.value}
                onChange={() => {
                  vm.setTheme(t.value);
                }}
              />
              {t.label}
            </label>
          ))}
        </fieldset>

        {vm.error && <p role="alert">{vm.error}</p>}
        <button type="submit" className="btn self-start" disabled={vm.saving}>
          Save settings
        </button>
        <p role="status">{vm.savedMessage ?? ''}</p>
      </form>

      <section aria-labelledby="storage-title" className="flex flex-col gap-2">
        <h2 id="storage-title" className="text-xl font-bold">
          Storage
        </h2>
        <p data-testid="storage-persistence">
          {vm.storagePersistence ? PERSISTENCE_TEXT[vm.storagePersistence] : 'Unknown.'}
        </p>
      </section>
    </section>
  );
}

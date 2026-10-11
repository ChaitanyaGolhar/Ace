import { Minus, Plus, Shield, ShieldCheck } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Theme } from '../../db/meta';
import { SyncStatusLine } from '../../ui/SyncStatus';
import { ErrorMessage, Loading } from '../shell/states';
import { useSettingsScreen } from './useSettingsScreen';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h2 className="border-b border-border pb-3 text-body font-medium text-text-secondary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  title,
  description,
  control,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      <div className="flex flex-col gap-1">
        <span id={id} className="text-body font-medium text-text">
          {title}
        </span>
        {description && (
          <span className="text-meta text-text-secondary lg:text-body">{description}</span>
        )}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}

const PERSISTENCE = {
  granted: {
    Icon: ShieldCheck,
    tone: 'text-success',
    title: 'Stored safely on this device',
    text: 'Your browser won’t clear your cards to free up space. Everything works offline.',
  },
  denied: {
    Icon: Shield,
    tone: 'text-warning',
    title: 'Saved on this device',
    text: 'Your browser may clear your cards if the device runs low on space. Export a backup now and then.',
  },
  unsupported: {
    Icon: Shield,
    tone: 'text-text-secondary',
    title: 'Saved on this device',
    text: 'This browser can’t promise to keep your cards when space runs low. Export a backup now and then.',
  },
} as const;

export function SettingsScreen() {
  const vm = useSettingsScreen();
  const fileRef = useRef<HTMLInputElement>(null);

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;
  const persistence = vm.storagePersistence ? PERSISTENCE[vm.storagePersistence] : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-page font-semibold tracking-tight">Settings</h1>
      {vm.error && (
        <p role="alert" className="text-error">
          {vm.error}
        </p>
      )}

      <Section title="Study">
        <Row
          id="new-per-day-label"
          title="New cards per day"
          description="Cards you haven’t seen before. Reviews are never limited."
          control={
            <div className="inline-flex h-[46px] items-stretch overflow-hidden rounded-md border border-border bg-surface lg:h-9">
              <button
                type="button"
                className="inline-flex w-12 items-center justify-center text-text"
                aria-label="Fewer new cards per day"
                onClick={() => {
                  vm.stepNewPerDay(-1);
                }}
              >
                <Minus aria-hidden="true" className="size-4" />
              </button>
              <input
                className="w-14 border-x border-border bg-transparent text-center text-body text-text"
                inputMode="numeric"
                aria-labelledby="new-per-day-label"
                value={vm.newPerDayText}
                onChange={(e) => {
                  vm.setNewPerDayText(e.target.value);
                }}
                onBlur={vm.commitNewPerDay}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') vm.commitNewPerDay();
                }}
              />
              <button
                type="button"
                className="inline-flex w-12 items-center justify-center text-text"
                aria-label="More new cards per day"
                onClick={() => {
                  vm.stepNewPerDay(1);
                }}
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
            </div>
          }
        />
        <Row
          id="rollover-label"
          title="New day starts at"
          description="Studying after midnight still counts as the same day."
          control={
            <select
              className="field w-auto min-w-36 pr-8"
              aria-labelledby="rollover-label"
              value={vm.rolloverHour}
              onChange={(e) => {
                vm.setRolloverHour(Number(e.target.value));
              }}
            >
              {vm.rolloverOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        />
      </Section>

      <Section title="Appearance">
        <Row
          id="theme-label"
          title="Theme"
          control={
            <div
              role="radiogroup"
              aria-labelledby="theme-label"
              className="inline-flex rounded-md border border-border bg-surface p-0.5"
            >
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={vm.theme === t.value}
                  className={`min-h-11 rounded-sm px-3 text-body lg:min-h-8 transition-colors duration-150 ${
                    vm.theme === t.value
                      ? 'bg-surface-raised font-medium text-text'
                      : 'text-text-secondary'
                  }`}
                  onClick={() => {
                    vm.setTheme(t.value);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        />
      </Section>

      <Section title="Account & sync">
        {vm.signInError && (
          <p role="alert" className="pt-4 text-error">
            {vm.signInError}
          </p>
        )}
        {vm.signedIn ? (
          <Row
            title={<>Signed in as {vm.email}</>}
            description={<SyncStatusLine view={vm.sync} />}
            control={
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={vm.syncNow}
                  disabled={vm.syncing}
                >
                  Sync now
                </button>
                <button type="button" className="btn-ghost" onClick={vm.signOut}>
                  Sign out
                </button>
              </div>
            }
          />
        ) : (
          <Row
            title="On this device only"
            control={
              <Link to="/signin" className="btn-secondary">
                Sign in to sync
              </Link>
            }
          />
        )}
        {persistence && (
          <div
            className="flex items-start gap-3 border-b border-border py-5"
            data-testid="storage-persistence"
          >
            <persistence.Icon
              aria-hidden="true"
              className={`mt-0.5 size-4 shrink-0 ${persistence.tone}`}
            />
            <div className="flex flex-col gap-1">
              <span className="text-body font-medium">{persistence.title}</span>
              <span className="text-meta text-text-secondary lg:text-body">{persistence.text}</span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Backup">
        <Row
          title="Your decks, cards and review history"
          description="Importing merges with what’s here. It never deletes anything."
          control={
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={vm.exportBackup}
                disabled={vm.busy}
              >
                Export
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={vm.busy}
                onClick={() => fileRef.current?.click()}
              >
                Import
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                tabIndex={-1}
                aria-label="Backup file to import"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) vm.importBackup(file);
                  e.target.value = '';
                }}
              />
            </div>
          }
        />
      </Section>

      <p className="text-meta text-text-muted lg:text-body">{vm.versionLine}</p>
    </div>
  );
}

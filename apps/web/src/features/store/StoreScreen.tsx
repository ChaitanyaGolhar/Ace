import { Check, ChevronLeft, Search, WifiOff } from 'lucide-react';
import { Link } from 'react-router';
import { formatCount } from '../../services/format';
import { ErrorMessage, Loading } from '../shell/states';
import { formatPrice, typesLabel, unitRange } from './storeView';
import { useStore, type StoreViewModel } from './useStore';

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** The deck store (BUILD_BRIEF_M6_M8 §7.7; UI plan in M7_M8_REPORT.md). */
export function StoreScreen() {
  const vm = useStore();
  const branchQuery = vm.filters.branch ? `?branch=${encodeURIComponent(vm.filters.branch)}` : '';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-2">
        <Link to="/decks" className="icon-btn -ml-3" aria-label="Back to decks">
          <ChevronLeft aria-hidden="true" className="size-5 text-text" />
        </Link>
        <h1 className="text-section font-semibold lg:text-page lg:tracking-tight">Store</h1>
      </header>
      <p className="text-body text-text-secondary">
        Adding a deck copies its cards to you. Updates come when the author fixes or adds cards.
      </p>

      {vm.offlineSince !== null && (
        <p role="status" className="flex items-center gap-2 text-body text-text-secondary">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          You’re offline. Showing the store as it was on {dateFormat.format(vm.offlineSince)}.
        </p>
      )}

      {vm.status === 'loading' && <Loading />}
      {vm.status === 'error' && (
        <ErrorMessage message="Couldn’t load the store. Please try again." />
      )}
      {vm.status === 'unavailable' && (
        <p role="status" className="flex items-center gap-2 text-body text-text-secondary">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          Connect to the internet to see the store.
        </p>
      )}

      {vm.status === 'ready' && vm.hasDecks && <Filters vm={vm} />}

      {vm.status === 'ready' && !vm.hasDecks && (
        <p className="text-body text-text-secondary">No decks in the store yet.</p>
      )}
      {vm.status === 'ready' && vm.hasDecks && vm.rows.length === 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-text-secondary">No decks match these filters.</p>
          <button type="button" className="btn-secondary" onClick={vm.clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {vm.rows.length > 0 && (
        <ul aria-label="Store decks" className="border-t border-border">
          {vm.rows.map(({ deck, inMyDecks, owned }) => (
            <li key={deck.slug} className="border-b border-border">
              <Link
                to={`/store/${deck.slug}${branchQuery}`}
                className="flex items-start gap-4 py-5 transition-colors duration-150 hover:bg-surface"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h2 className="text-section font-semibold">{deck.catalog.subject}</h2>
                  {deck.title !== deck.catalog.subject && (
                    <p className="text-body text-text-secondary">{deck.title}</p>
                  )}
                  <p className="text-body text-text-muted">
                    {deck.catalog.year} · Sem {deck.catalog.semester} · {unitRange(deck.units)} ·{' '}
                    <span>{formatCount(deck.cardCount)}</span> cards
                  </p>
                  <p className="text-meta text-text-muted">{typesLabel(deck.typeCounts)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-body">
                  <span className="font-medium">{owned ? 'Owned' : formatPrice(deck.price)}</span>
                  {inMyDecks && (
                    <span className="flex items-center gap-1 text-meta text-text-secondary">
                      <Check aria-hidden="true" className="size-4 text-success" />
                      In your decks
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChipRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = String,
}: {
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
  format?: (v: T) => string;
}) {
  const chip = (on: boolean) =>
    // 32px to look at; the ::before keeps the tap area 44px tall on phones.
    `relative inline-flex h-8 items-center rounded-md border px-2.5 text-small transition-colors duration-150 before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-[''] lg:before:hidden ${
      on
        ? 'border-accent bg-surface-raised font-medium text-text'
        : 'border-border text-text-secondary hover:bg-surface-raised hover:text-text'
    }`;
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-1.5 gap-y-3.5"
    >
      <span className="w-[72px] shrink-0 text-meta text-text-secondary">{label}</span>
      <button
        type="button"
        aria-pressed={value === null}
        className={chip(value === null)}
        onClick={() => {
          onChange(null);
        }}
      >
        All
      </button>
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          aria-pressed={value === o}
          className={chip(value === o)}
          onClick={() => {
            onChange(o);
          }}
        >
          {format(o)}
        </button>
      ))}
    </div>
  );
}

function Filters({ vm }: { vm: StoreViewModel }) {
  return (
    <section aria-label="Filters" className="flex flex-col gap-3">
      <ChipRow label="Year" options={vm.years} value={vm.filters.year} onChange={vm.setYear} />
      <ChipRow
        label="Semester"
        options={vm.semesters}
        value={vm.filters.semester}
        onChange={vm.setSemester}
      />
      <ChipRow
        label="Branch"
        options={vm.branches}
        value={vm.filters.branch}
        onChange={vm.setBranch}
      />
      <label className="relative mt-1">
        <span className="sr-only">Search subjects</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
        />
        <input
          type="search"
          className="field pl-9"
          placeholder="Search subjects"
          value={vm.search}
          onChange={(e) => {
            vm.setSearch(e.target.value);
          }}
        />
      </label>
    </section>
  );
}

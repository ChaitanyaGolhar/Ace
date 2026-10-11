import { ChevronRight, Search } from 'lucide-react';
import { Link } from 'react-router';
import { ErrorMessage } from '../shell/states';
import { useSearch } from './useSearch';

export function SearchScreen() {
  const vm = useSearch();
  const { decks, cards } = vm.results;
  const nothing = vm.status === 'ready' && decks.length === 0 && cards.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-page font-semibold tracking-tight">Search</h1>
      <label className="relative block">
        <span className="sr-only">Search decks and cards</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
        />
        <input
          type="search"
          className="field pl-10"
          placeholder="Search decks, questions and answers"
          value={vm.query}
          autoFocus
          onChange={(e) => {
            vm.setQuery(e.target.value);
          }}
        />
      </label>

      {vm.status === 'error' && <ErrorMessage />}
      {nothing && (
        <p data-testid="search-no-results" className="text-body text-text-secondary">
          Nothing matches “{vm.query.trim()}”.
        </p>
      )}

      {decks.length > 0 && (
        <section aria-labelledby="deck-results" className="flex flex-col gap-3">
          <h2 id="deck-results" className="text-body font-medium text-text-secondary">
            Decks
          </h2>
          <ul className="border-t border-border">
            {decks.map((d) => (
              <li key={d.id} className="border-b border-border">
                <Link
                  to={`/decks/${d.id}`}
                  className="flex min-h-12 items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-surface"
                >
                  <span className="flex-1 truncate">{d.name}</span>
                  <ChevronRight aria-hidden="true" className="size-4 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards.length > 0 && (
        <section aria-labelledby="card-results" className="flex flex-col gap-3">
          <h2 id="card-results" className="text-body font-medium text-text-secondary">
            Cards
          </h2>
          <ul className="border-t border-border">
            {cards.map((c) => (
              <li key={c.id} className="border-b border-border">
                <Link
                  to={`/cards/${c.id}/edit`}
                  className="flex min-h-12 flex-col justify-center px-2 py-2"
                >
                  <span className="truncate">{c.front}</span>
                  <span className="text-meta text-text-secondary">{c.deckName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

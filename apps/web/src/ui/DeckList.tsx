import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { DeckRow } from '../features/home/deckRows';

/** "Your decks" rows: name, meta line, "N due" pill or "Up to date". Used by Home and Decks. */
export function DeckList({ decks, label }: { decks: DeckRow[]; label: string }) {
  return (
    <ul aria-label={label} className="border-t border-border">
      {decks.map((deck) => (
        <li key={deck.id} className="border-b border-border">
          <Link
            to={`/decks/${deck.id}`}
            className="flex min-h-[72px] items-center gap-3 rounded-md px-2 py-3 transition-colors duration-150 hover:bg-surface"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[17px] font-medium text-text">{deck.name}</span>
              <span className="text-body text-text-secondary">{deck.meta}</span>
            </span>
            {deck.due > 0 ? (
              <span className="pill tabular-nums" data-testid="deck-due">
                {deck.due} due
              </span>
            ) : (
              <span className="text-body text-text-muted">Up to date</span>
            )}
            <ChevronRight aria-hidden="true" className="hidden size-5 text-text-muted lg:block" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

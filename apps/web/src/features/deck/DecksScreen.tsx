import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { DeckList } from '../../ui/DeckList';
import { ErrorMessage, Loading } from '../shell/states';
import { useDecks } from './useDecks';

export function DecksScreen() {
  const vm = useDecks();
  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-page font-semibold tracking-tight lg:text-[40px]">Decks</h1>
        <Link to="/decks/new" className="btn-primary">
          <Plus aria-hidden="true" className="size-5" />
          New deck
        </Link>
      </header>
      {vm.decks.length === 0 ? (
        <p data-testid="decks-empty" className="text-body text-text-secondary">
          No decks yet. Create one to start adding cards.
        </p>
      ) : (
        <DeckList decks={vm.decks} label="Decks" />
      )}
      {vm.hasReadyMade && (
        <Link to="/browse" className="link self-start px-2">
          <Plus aria-hidden="true" className="size-5" />
          Add a ready-made deck
        </Link>
      )}
    </div>
  );
}

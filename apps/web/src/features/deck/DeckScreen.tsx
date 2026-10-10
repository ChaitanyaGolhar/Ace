import { MAX_DECK_NAME_LENGTH } from '@recall/core';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Dialog } from '../../ui/Dialog';
import { Menu } from '../../ui/Menu';
import { ErrorMessage, Loading, NotFound } from '../shell/states';
import { useDeck } from './useDeck';

export function DeckScreen() {
  const { deckId = '' } = useParams();
  const vm = useDeck(deckId);

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;
  if (vm.status === 'notFound')
    return <NotFound message="This deck doesn’t exist or was deleted." />;

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-body">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/decks" className="text-link">
              Decks
            </Link>
          </li>
          <li aria-hidden="true" className="text-text-muted">
            /
          </li>
          <li aria-current="page" className="truncate text-text">
            {vm.name}
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h1 className="text-page font-semibold tracking-tight break-words lg:text-[40px]">
              {vm.name}
            </h1>
            <p
              className="text-body text-text-secondary lg:text-section lg:font-normal"
              data-testid="deck-meta"
            >
              {vm.meta}
            </p>
          </div>
          <Menu
            label="Deck options"
            buttonClassName="icon-btn border border-border bg-surface"
            items={[
              { label: 'Rename deck', onSelect: vm.openRename },
              { label: 'Delete deck…', onSelect: vm.openDelete, danger: true },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          {vm.canStudy ? (
            <Link to={`/study?deck=${vm.deckId}`} className="btn-primary px-6">
              Study deck
              <ArrowRight aria-hidden="true" className="size-5" />
            </Link>
          ) : (
            <button type="button" className="btn px-6" disabled>
              Nothing to study
            </button>
          )}
          <Link to={`/decks/${vm.deckId}/cards/new`} className="btn-secondary px-6">
            <Plus aria-hidden="true" className="size-5" />
            Add card
          </Link>
        </div>
      </header>

      <section aria-labelledby="cards-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="cards-title" className="text-section font-semibold lg:text-[22px]">
            Cards
          </h2>
          <label className="relative block lg:w-[340px]">
            <span className="sr-only">Search cards</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              className="field pl-11"
              placeholder="Search questions and answers"
              value={vm.search}
              onChange={(e) => {
                vm.setSearch(e.target.value);
              }}
            />
          </label>
        </div>

        {vm.cardCount === 0 ? (
          <p
            data-testid="deck-empty"
            className="border-t border-border pt-6 text-body text-text-secondary"
          >
            No cards yet. Add your first card.
          </p>
        ) : vm.cards.length === 0 ? (
          <p
            data-testid="search-empty"
            className="border-t border-border pt-6 text-body text-text-secondary"
          >
            No cards match “{vm.search.trim()}”.
          </p>
        ) : (
          <ul aria-label="Cards" className="border-t border-border">
            {vm.cards.map((card) => (
              <li
                key={card.id}
                className="flex min-h-16 items-center gap-3 border-b border-border px-2"
              >
                <span className="min-w-0 flex-1 truncate text-body lg:text-[17px]">
                  {card.front}
                </span>
                <span
                  className={`shrink-0 text-meta lg:text-body ${
                    card.isDue ? 'font-medium text-text' : 'text-text-secondary'
                  }`}
                >
                  {card.dueLabel}
                </span>
                <Menu
                  label={`Card options: ${card.front}`}
                  items={[
                    {
                      label: 'Edit card',
                      onSelect: () => {
                        vm.editCard(card.id);
                      },
                    },
                    {
                      label: 'Delete card',
                      danger: true,
                      onSelect: () => {
                        vm.deleteCard(card.id);
                      },
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        {vm.isReadyMade && (
          <p className="text-meta text-text-muted lg:text-body">
            Ready-made deck. These are your copies — edit any card freely.
          </p>
        )}
      </section>

      <Dialog open={vm.renameOpen} onClose={vm.closeRename} title="Rename deck">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            vm.saveRename();
          }}
        >
          <label className="flex flex-col gap-2 text-body text-text-secondary">
            Deck name
            <input
              className="field"
              value={vm.renameValue}
              maxLength={MAX_DECK_NAME_LENGTH}
              data-autofocus
              onChange={(e) => {
                vm.setRenameValue(e.target.value);
              }}
            />
          </label>
          {vm.renameError && (
            <p role="alert" className="text-error">
              {vm.renameError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 lg:flex-row lg:justify-end">
            <button type="button" className="btn-secondary" onClick={vm.closeRename}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save name
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={vm.deleteOpen} onClose={vm.closeDelete} title={`Delete ${vm.name}?`}>
        <p className="text-body text-text-secondary">
          This deletes the deck and its {vm.cardCount} {vm.cardCount === 1 ? 'card' : 'cards'}. It
          can’t be undone.
        </p>
        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:justify-end">
          <button type="button" className="btn-secondary" onClick={vm.closeDelete} data-autofocus>
            Keep deck
          </button>
          <button type="button" className="btn-danger" onClick={vm.confirmDelete}>
            Delete deck
          </button>
        </div>
      </Dialog>
    </div>
  );
}

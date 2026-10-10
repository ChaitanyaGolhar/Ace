import { MAX_DECK_NAME_LENGTH } from '@recall/core';
import { Link, useParams } from 'react-router';
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
    <section aria-labelledby="deck-title" className="flex flex-col gap-4">
      {vm.renaming ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            vm.saveRename();
          }}
        >
          <label className="flex flex-1 flex-col gap-1">
            Deck name
            <input
              className="field"
              value={vm.renameValue}
              maxLength={MAX_DECK_NAME_LENGTH}
              autoFocus
              onChange={(e) => {
                vm.setRenameValue(e.target.value);
              }}
            />
          </label>
          <button type="submit" className="btn">
            Save name
          </button>
          <button type="button" className="btn" onClick={vm.cancelRename}>
            Cancel
          </button>
          {vm.renameError && <p role="alert">{vm.renameError}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="deck-title" className="flex-1 text-2xl font-bold">
            {vm.name}
          </h1>
          <button type="button" className="btn" onClick={vm.startRename}>
            Rename
          </button>
        </div>
      )}

      <p>
        {vm.counts.due + vm.counts.learning} due · {vm.counts.new} new · {vm.cardCount} cards
      </p>

      <div className="flex flex-wrap gap-2">
        {vm.canStudy && (
          <Link to={`/study?deck=${vm.deckId}`} className="btn">
            Study this deck
          </Link>
        )}
        <Link to={`/decks/${vm.deckId}/cards/new`} className="btn">
          Add card
        </Link>
      </div>

      <label className="flex flex-col gap-1">
        Search cards
        <input
          type="search"
          className="field"
          value={vm.search}
          onChange={(e) => {
            vm.setSearch(e.target.value);
          }}
        />
      </label>

      {vm.cardCount === 0 ? (
        <p data-testid="deck-empty">No cards yet. Add your first card.</p>
      ) : vm.cards.length === 0 ? (
        <p data-testid="search-empty">No cards match “{vm.search.trim()}”.</p>
      ) : (
        <ul aria-label="Cards" className="flex flex-col gap-2">
          {vm.cards.map((card) => (
            <li key={card.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate">{card.front}</p>
                <p className="truncate">{card.back}</p>
              </div>
              <Link
                to={`/cards/${card.id}/edit`}
                className="btn"
                aria-label={`Edit card: ${card.front}`}
              >
                Edit
              </Link>
              <button
                type="button"
                className="btn"
                aria-label={`Delete card: ${card.front}`}
                onClick={() => {
                  vm.deleteCard(card.id);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t pt-4">
        {vm.confirmingDelete ? (
          <div role="alertdialog" aria-labelledby="delete-deck-q" className="flex flex-col gap-2">
            <p id="delete-deck-q">
              Delete “{vm.name}” and its {vm.cardCount} cards? This can’t be undone.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={vm.confirmDeleteDeck}>
                Delete deck
              </button>
              <button type="button" className="btn" onClick={vm.cancelDeleteDeck} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn self-start" onClick={vm.requestDeleteDeck}>
            Delete deck…
          </button>
        )}
      </div>
    </section>
  );
}

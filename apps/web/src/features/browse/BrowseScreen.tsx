import { Check, ChevronLeft } from 'lucide-react';
import { Link } from 'react-router';
import { Dialog } from '../../ui/Dialog';
import { ErrorMessage, Loading } from '../shell/states';
import { useBrowse } from './useBrowse';

export function BrowseScreen() {
  const vm = useBrowse();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-2">
        <Link to="/decks" className="icon-btn -ml-3" aria-label="Back to decks">
          <ChevronLeft aria-hidden="true" className="size-6 text-text" />
        </Link>
        <h1 className="text-section font-semibold lg:text-page lg:tracking-tight">
          Ready-made decks
        </h1>
      </header>
      <p className="border-b border-border pb-5 text-body text-text-secondary lg:text-section lg:font-normal">
        Adding a deck copies its cards to you. Edit them however you like.
      </p>

      {vm.status === 'loading' && <Loading />}
      {vm.status === 'error' && <ErrorMessage />}
      {vm.status === 'ready' && vm.decks.length === 0 && (
        <p data-testid="browse-empty" className="text-body text-text-secondary">
          No ready-made decks are bundled with this version yet.
        </p>
      )}
      {vm.error && (
        <p role="alert" className="text-error">
          {vm.error}
        </p>
      )}

      {vm.decks.length > 0 && (
        <ul aria-label="Ready-made decks">
          {vm.decks.map((deck) => (
            <li
              key={deck.prebuiltId}
              className="flex items-start gap-4 border-b border-border py-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="text-section font-semibold">{deck.name}</h2>
                <p className="text-body text-text-secondary">{deck.description}</p>
                <p className="flex items-center gap-2 text-body text-text-muted">
                  {deck.inMyDecks && (
                    <>
                      <Check aria-hidden="true" className="size-4 text-success" />
                      In your decks ·
                    </>
                  )}
                  <span>
                    <span className="font-mono">{deck.cardCount}</span> cards
                  </span>
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                aria-label={`Add ${deck.name}`}
                disabled={vm.adding}
                onClick={() => {
                  vm.add(deck.prebuiltId);
                }}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={vm.confirming !== null}
        onClose={vm.keepOneCopy}
        title={`Add ${vm.confirming?.name ?? ''} again?`}
        testId="duplicate-warning"
      >
        <p className="text-body text-text-secondary lg:text-section lg:font-normal">
          You already have this deck. Adding it again makes a second copy that starts from scratch.
          Your progress on the first copy isn’t touched.
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="btn-secondary min-h-14 text-section"
            onClick={vm.addSecondCopy}
          >
            Add a second copy
          </button>
          <button
            type="button"
            className="btn-primary min-h-14 text-section"
            onClick={vm.keepOneCopy}
            data-autofocus
          >
            Keep one copy
          </button>
        </div>
      </Dialog>
    </div>
  );
}

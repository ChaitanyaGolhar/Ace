import { MAX_DECK_NAME_LENGTH } from '@recall/core';
import { useNewDeck } from './useNewDeck';

export function NewDeckScreen() {
  const vm = useNewDeck();
  return (
    <section aria-labelledby="new-deck-title" className="mx-auto flex max-w-[640px] flex-col gap-6">
      <h1 id="new-deck-title" className="text-page font-semibold tracking-tight">
        New deck
      </h1>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          vm.create();
        }}
      >
        <label className="flex flex-col gap-2 text-body text-text-secondary">
          Deck name
          <input
            className="field"
            value={vm.name}
            maxLength={MAX_DECK_NAME_LENGTH}
            onChange={(e) => {
              vm.setName(e.target.value);
            }}
            aria-invalid={vm.error !== null}
            aria-describedby={vm.error ? 'deck-name-error' : undefined}
            autoFocus
          />
        </label>
        {vm.error && (
          <p id="deck-name-error" role="alert" className="text-error">
            {vm.error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={vm.saving}>
          Create deck
        </button>
      </form>
    </section>
  );
}

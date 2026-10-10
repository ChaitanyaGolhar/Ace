import { useNewDeck } from './useNewDeck';

export function NewDeckScreen() {
  const vm = useNewDeck();
  return (
    <section aria-labelledby="new-deck-title" className="flex flex-col gap-4">
      <h1 id="new-deck-title" className="text-2xl font-bold">
        Create a deck
      </h1>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          vm.create();
        }}
      >
        <label className="flex flex-col gap-1">
          Deck name
          <input
            className="field"
            value={vm.name}
            maxLength={200}
            onChange={(e) => {
              vm.setName(e.target.value);
            }}
            aria-invalid={vm.error !== null}
            aria-describedby={vm.error ? 'deck-name-error' : undefined}
            autoFocus
          />
        </label>
        {vm.error && (
          <p id="deck-name-error" role="alert">
            {vm.error}
          </p>
        )}
        <button type="submit" className="btn" disabled={vm.saving}>
          Create deck
        </button>
      </form>
    </section>
  );
}

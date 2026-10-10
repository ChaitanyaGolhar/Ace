import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import { ErrorMessage, Loading, NotFound } from '../shell/states';
import { useCardEditor, type CardEditorTarget } from './useCardEditor';

export function CardEditorScreen() {
  const { deckId, cardId } = useParams();
  const target: CardEditorTarget =
    cardId !== undefined ? { mode: 'edit', cardId } : { mode: 'new', deckId: deckId ?? '' };
  const vm = useCardEditor(target);
  const frontRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (vm.focusFrontToken > 0) frontRef.current?.focus();
  }, [vm.focusFrontToken]);

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;
  if (vm.status === 'notFound')
    return <NotFound message="This card doesn’t exist or was deleted." />;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      vm.saveAndContinue();
    }
  };
  const primaryLabel = vm.mode === 'new' ? 'Save & add another' : 'Save';

  return (
    <section aria-labelledby="editor-title" className="flex flex-col gap-4">
      <h1 id="editor-title" className="text-2xl font-bold">
        {vm.mode === 'new' ? 'Add card' : 'Edit card'}
      </h1>
      <form
        className="flex flex-col gap-3"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          vm.saveAndContinue();
        }}
      >
        <label className="flex flex-col gap-1">
          Front
          <textarea
            ref={frontRef}
            className="field min-h-24"
            value={vm.front}
            maxLength={20000}
            autoFocus
            aria-invalid={vm.frontError !== null}
            aria-describedby={vm.frontError ? 'front-error' : undefined}
            onChange={(e) => {
              vm.setFront(e.target.value);
            }}
          />
        </label>
        {vm.frontError && (
          <p id="front-error" role="alert">
            {vm.frontError}
          </p>
        )}
        <label className="flex flex-col gap-1">
          Back
          <textarea
            className="field min-h-24"
            value={vm.back}
            maxLength={20000}
            aria-invalid={vm.backError !== null}
            aria-describedby={vm.backError ? 'back-error' : undefined}
            onChange={(e) => {
              vm.setBack(e.target.value);
            }}
          />
        </label>
        {vm.backError && (
          <p id="back-error" role="alert">
            {vm.backError}
          </p>
        )}
        {vm.formError && <p role="alert">{vm.formError}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="btn"
            disabled={vm.saving}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            {primaryLabel}
          </button>
          <button type="button" className="btn" onClick={vm.done}>
            {vm.mode === 'new' ? 'Done' : 'Cancel'}
          </button>
        </div>
        <p className="text-sm">Tip: Ctrl+Enter (⌘+Enter on Mac) to {primaryLabel.toLowerCase()}.</p>
        <p role="status" data-testid="added-status">
          {vm.addedCount > 0 ? `Card added (${String(vm.addedCount)} so far)` : ''}
        </p>
      </form>
    </section>
  );
}

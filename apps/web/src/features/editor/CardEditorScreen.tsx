import { MAX_CARD_TEXT_LENGTH } from '@recall/core';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import { Dialog } from '../../ui/Dialog';
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
      vm.saveAndAddAnother();
    }
  };
  const isNew = vm.mode === 'new';
  const title = isNew ? 'New card' : 'Edit card';

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[640px] flex-col lg:min-h-0">
      <header className="-mx-4 grid grid-cols-[1fr_auto_1fr] items-center border-b border-border px-4 py-2 lg:mx-0 lg:mb-8 lg:flex lg:border-0 lg:p-0">
        <button
          type="button"
          className="btn-ghost justify-self-start px-0 lg:hidden"
          onClick={vm.cancel}
        >
          Cancel
        </button>
        <h1 className="text-section font-semibold lg:text-page lg:tracking-tight">{title}</h1>
      </header>

      <form
        className="flex flex-1 flex-col gap-6 pt-6 lg:pt-0"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          vm.saveAndAddAnother();
        }}
      >
        <label className="flex flex-col gap-2 text-body font-medium text-text-secondary">
          Deck
          <span className="relative">
            <select
              className="field appearance-none pr-12 font-normal"
              value={vm.deckId ?? ''}
              disabled={!isNew}
              onChange={(e) => {
                vm.setDeckId(e.target.value);
              }}
            >
              {vm.deckId === null && <option value="">Choose a deck</option>}
              {vm.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-text-secondary"
            />
          </span>
        </label>

        <label className="flex flex-col gap-2 text-body font-medium text-text-secondary">
          Question
          <textarea
            ref={frontRef}
            className="field min-h-32 resize-y py-3 text-section font-normal text-text"
            value={vm.front}
            maxLength={MAX_CARD_TEXT_LENGTH}
            autoFocus
            aria-invalid={vm.frontError !== null}
            aria-describedby={vm.frontError ? 'front-error' : undefined}
            onChange={(e) => {
              vm.setFront(e.target.value);
            }}
          />
        </label>
        {vm.frontError && (
          <p id="front-error" role="alert" className="-mt-4 text-error">
            {vm.frontError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-2 text-body font-medium text-text-secondary">
            Answer
            <textarea
              className="field min-h-32 resize-y py-3 text-section font-normal text-text"
              value={vm.back}
              maxLength={MAX_CARD_TEXT_LENGTH}
              aria-invalid={vm.backError !== null}
              aria-describedby={vm.backError ? 'back-error' : 'card-tip'}
              onChange={(e) => {
                vm.setBack(e.target.value);
              }}
            />
          </label>
          {vm.backError && (
            <p id="back-error" role="alert" className="text-error">
              {vm.backError}
            </p>
          )}
          <p id="card-tip" className="text-meta text-text-muted lg:text-body">
            Tip: one idea per card is easier to remember.
          </p>
        </div>

        {vm.formError && (
          <p role="alert" className="text-error">
            {vm.formError}
          </p>
        )}

        <p
          role="status"
          data-testid="added-status"
          className="flex min-h-6 items-center gap-2 text-body text-text-secondary"
        >
          {vm.addedStatus && (
            <>
              <Check aria-hidden="true" className="size-5 text-success" />
              {vm.addedStatus}
            </>
          )}
        </p>

        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t border-border bg-bg px-4 pt-4 pb-2 lg:static lg:mx-0 lg:mt-0 lg:flex-row lg:border-0 lg:px-0 lg:pt-0">
          <button
            type="submit"
            className="btn-primary min-h-14 text-section lg:min-h-11 lg:text-body"
            disabled={vm.saving}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            {isNew ? 'Save & add another' : 'Save changes'}
          </button>
          {isNew ? (
            <button
              type="button"
              className="btn-ghost min-h-14 text-section text-text lg:min-h-11 lg:text-body"
              onClick={vm.saveAndClose}
              disabled={vm.saving}
            >
              Save and close
            </button>
          ) : null}
          <button type="button" className="btn-ghost hidden lg:inline-flex" onClick={vm.cancel}>
            Cancel
          </button>
        </div>
      </form>

      <Dialog open={vm.confirmLeave} onClose={vm.keepEditing} title="Discard this card?">
        <p className="text-body text-text-secondary">What you typed hasn’t been saved.</p>
        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:justify-end">
          <button type="button" className="btn-danger" onClick={vm.discardAndLeave}>
            Discard
          </button>
          <button type="button" className="btn-primary" onClick={vm.keepEditing} data-autofocus>
            Keep editing
          </button>
        </div>
      </Dialog>
    </div>
  );
}

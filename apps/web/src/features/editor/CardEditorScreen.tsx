import { CARD_TYPES } from '@recall/core';
import { ArrowDown, ArrowUp, Check, ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Dialog } from '../../ui/Dialog';
import { ErrorMessage, Loading, NotFound } from '../shell/states';
import { TYPE_LABELS } from './draft';
import { useCardEditor, type CardEditorTarget, type CardEditorViewModel } from './useCardEditor';

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
        {/* An explicit label: wrapping the select would put every deck name in its label. */}
        <div className="flex flex-col gap-2">
          <label htmlFor="deck-select" className="text-body font-medium text-text-secondary">
            Deck
          </label>
          <span className="relative">
            <select
              id="deck-select"
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
        </div>

        <TypePicker vm={vm} />

        <Fields vm={vm} frontRef={frontRef} />

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
            disabled={vm.saving || !vm.valid}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            {isNew ? 'Save & add another' : 'Save changes'}
          </button>
          {isNew ? (
            <button
              type="button"
              className="btn-ghost min-h-14 text-section text-text lg:min-h-11 lg:text-body"
              onClick={vm.saveAndClose}
              disabled={vm.saving || (vm.dirty && !vm.valid)}
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

      <Dialog
        open={vm.typeChange !== null}
        onClose={vm.cancelTypeChange}
        title={vm.typeChange?.title ?? ''}
      >
        <p className="text-body text-text-secondary">{vm.typeChange?.message}</p>
        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:justify-end">
          <button type="button" className="btn-secondary" onClick={vm.confirmTypeChange}>
            Change type
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={vm.cancelTypeChange}
            data-autofocus
          >
            Keep{' '}
            {vm.draft.type === 'mcq' ? 'multiple choice' : TYPE_LABELS[vm.draft.type].toLowerCase()}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

/** Segmented control on desktop, a select on phones (§6.5). */
function TypePicker({ vm }: { vm: CardEditorViewModel }) {
  return (
    <>
      {/* An explicit label: wrapping the select would put every option's text in its name. */}
      <div className="flex flex-col gap-2 lg:hidden">
        <label htmlFor="card-type-select" className="text-body font-medium text-text-secondary">
          Card type
        </label>
        <span className="relative">
          <select
            id="card-type-select"
            className="field appearance-none pr-12 font-normal"
            value={vm.draft.type}
            onChange={(e) => {
              vm.setType(e.target.value as (typeof CARD_TYPES)[number]);
            }}
          >
            {CARD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-text-secondary"
          />
        </span>
      </div>
      <div className="hidden flex-col gap-2 lg:flex">
        <span id="card-type-label" className="text-body font-medium text-text-secondary">
          Card type
        </span>
        <div
          role="radiogroup"
          aria-labelledby="card-type-label"
          className="inline-flex flex-wrap self-start rounded-lg border border-border bg-surface p-1"
        >
          {CARD_TYPES.map((t) => {
            const on = vm.draft.type === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  vm.setType(t);
                }}
                className={`min-h-10 rounded-md px-3 text-body transition-colors duration-150 ${
                  on ? 'bg-surface-raised font-medium text-text' : 'text-text-secondary'
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

const labelClass = 'flex flex-col gap-2 text-body font-medium text-text-secondary';
const areaClass = 'field min-h-32 resize-y py-3 text-section font-normal text-text';
const inputClass = 'field text-section font-normal text-text';

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="-mt-1 text-error">
      {message}
    </p>
  );
}

function TextArea({
  vm,
  field,
  label,
  value,
  onChange,
  areaRef,
  autoFocus,
  describedBy,
  minHeight = 'min-h-32',
}: {
  vm: CardEditorViewModel;
  field: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  areaRef?: React.RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  describedBy?: string;
  minHeight?: string;
}) {
  const error = vm.errors[field];
  const errorId = `${field}-error`;
  return (
    <div className="flex flex-col gap-2">
      <label className={labelClass}>
        {label}
        <textarea
          ref={areaRef}
          className={areaClass.replace('min-h-32', minHeight)}
          value={value}
          autoFocus={autoFocus}
          aria-invalid={error !== undefined}
          aria-describedby={error ? errorId : describedBy}
          onBlur={() => {
            vm.touch(field);
          }}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function Fields({
  vm,
  frontRef,
}: {
  vm: CardEditorViewModel;
  frontRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const d = vm.draft;
  const prompt = (label: string, describedBy?: string) => (
    <TextArea
      vm={vm}
      field="prompt"
      label={label}
      value={d.prompt}
      areaRef={frontRef}
      autoFocus
      describedBy={describedBy}
      onChange={(v) => {
        vm.update({ prompt: v });
      }}
    />
  );
  const optional = (field: 'explanation' | 'extra' | 'modelAnswer', label: string) => (
    <TextArea
      vm={vm}
      field={field}
      label={label}
      value={d[field]}
      minHeight="min-h-24"
      onChange={(v) => {
        vm.update({ [field]: v });
      }}
    />
  );

  switch (d.type) {
    case 'basic':
      return (
        <>
          {prompt('Question')}
          <TextArea
            vm={vm}
            field="answer"
            label="Answer"
            value={d.answer}
            describedBy="card-tip"
            onChange={(v) => {
              vm.update({ answer: v });
            }}
          />
          <p id="card-tip" className="-mt-4 text-meta text-text-muted lg:text-body">
            Tip: one idea per card is easier to remember.
          </p>
        </>
      );
    case 'short':
      return (
        <>
          {prompt('Question')}
          <TextArea
            vm={vm}
            field="answer"
            label="Model answer"
            value={d.answer}
            describedBy="short-tip"
            onChange={(v) => {
              vm.update({ answer: v });
            }}
          />
          <p id="short-tip" className="-mt-4 text-meta text-text-muted lg:text-body">
            One to three sentences.
          </p>
          {optional('explanation', 'Explanation (optional)')}
        </>
      );
    case 'mcq':
      return (
        <>
          {prompt('Question')}
          <McqOptions vm={vm} />
          {optional('explanation', 'Explanation (optional)')}
        </>
      );
    case 'cloze':
      return (
        <>
          {prompt('Sentence', 'cloze-help')}
          <p id="cloze-help" className="-mt-4 text-meta text-text-muted lg:text-body">
            Wrap the answer in {'{{double braces}}'}, e.g. “A {'{{primary key}}'} identifies a row.”
          </p>
          <ListField
            vm={vm}
            field="accepted"
            legend="Other accepted answers (optional)"
            itemLabel={(i) => `Accepted answer ${String(i + 1)}`}
            items={d.accepted}
            onChange={(accepted) => {
              vm.update({ accepted });
            }}
            onAdd={vm.addAccepted}
            addLabel="Add accepted answer"
            max={10}
            onRemove={vm.removeAccepted}
            canRemove={() => true}
          />
          <label className={labelClass}>
            Hint (optional)
            <input
              type="text"
              className={inputClass}
              value={d.hint}
              onChange={(e) => {
                vm.update({ hint: e.target.value });
              }}
            />
          </label>
          {optional('extra', 'Extra note (optional)')}
        </>
      );
    case 'long':
      return (
        <>
          {prompt('Question')}
          <div className="flex flex-col gap-2">
            <label className={labelClass}>
              Marks (optional)
              <input
                type="text"
                inputMode="numeric"
                className={`${inputClass} max-w-32`}
                value={d.marks}
                aria-invalid={vm.errors.marks !== undefined}
                aria-describedby={vm.errors.marks ? 'marks-error' : undefined}
                onBlur={() => {
                  vm.touch('marks');
                }}
                onChange={(e) => {
                  vm.update({ marks: e.target.value });
                }}
              />
            </label>
            <FieldError id="marks-error" message={vm.errors.marks} />
          </div>
          <ListField
            vm={vm}
            field="keyPoints"
            legend="Key points"
            itemLabel={(i) => `Key point ${String(i + 1)}`}
            items={d.keyPoints}
            onChange={(keyPoints) => {
              vm.update({ keyPoints });
            }}
            onAdd={vm.addKeyPoint}
            addLabel="Add key point"
            max={12}
            onRemove={vm.removeKeyPoint}
            canRemove={() => d.keyPoints.length > 1}
            onMove={vm.moveKeyPoint}
          />
          {optional('modelAnswer', 'Model answer (optional)')}
        </>
      );
  }
}

function McqOptions({ vm }: { vm: CardEditorViewModel }) {
  const d = vm.draft;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-body font-medium text-text-secondary">
        Options — mark the correct one
      </legend>
      {d.options.map((text, i) => {
        const letter = 'ABCDEF'[i] ?? '';
        const field = `options.${String(i)}`;
        const error = vm.errors[field];
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="radio"
                  name="correct"
                  className="size-5 accent-[var(--color-accent)]"
                  checked={d.correct === i}
                  aria-label={`Option ${letter} is correct`}
                  onChange={() => {
                    vm.update({ correct: i });
                  }}
                />
              </label>
              <label className="sr-only" htmlFor={`option-${String(i)}`}>
                Option {letter}
              </label>
              <span aria-hidden="true" className="font-mono text-text-secondary">
                {letter}.
              </span>
              <input
                id={`option-${String(i)}`}
                type="text"
                className={`${inputClass} flex-1`}
                value={text}
                aria-invalid={error !== undefined}
                aria-describedby={error ? `${field}-error` : undefined}
                onBlur={() => {
                  vm.touch(field);
                }}
                onChange={(e) => {
                  const options = [...d.options];
                  options[i] = e.target.value;
                  vm.update({ options });
                }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove option ${letter}`}
                disabled={d.options.length <= 2}
                onClick={() => {
                  vm.removeOption(i);
                }}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            {d.correct === i && (
              <p className="ml-13 inline-flex items-center gap-1 text-meta font-medium text-success">
                <Check aria-hidden="true" className="size-4" />
                Correct answer
              </p>
            )}
            <FieldError id={`${field}-error`} message={error} />
          </div>
        );
      })}
      {d.options.length < 6 && (
        <button type="button" className="btn-ghost self-start px-0" onClick={vm.addOption}>
          <Plus aria-hidden="true" className="size-5" />
          Add option
        </button>
      )}
      <FieldError id="options-error" message={vm.errors.options} />
      <FieldError id="correct-error" message={vm.errors.correct} />
    </fieldset>
  );
}

function ListField({
  vm,
  field,
  legend,
  itemLabel,
  items,
  onChange,
  onAdd,
  addLabel,
  max,
  onRemove,
  canRemove,
  onMove,
}: {
  vm: CardEditorViewModel;
  field: string;
  legend: string;
  itemLabel: (i: number) => string;
  items: string[];
  onChange: (items: string[]) => void;
  onAdd: () => void;
  addLabel: string;
  max: number;
  onRemove: (i: number) => void;
  canRemove: () => boolean;
  onMove?: (i: number, by: -1 | 1) => void;
}): ReactNode {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-body font-medium text-text-secondary">{legend}</legend>
      {items.map((text, i) => {
        const key = `${field}.${String(i)}`;
        const error = vm.errors[key];
        const label = itemLabel(i);
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={key}>
                {label}
              </label>
              <input
                id={key}
                type="text"
                className={`${inputClass} flex-1`}
                value={text}
                aria-invalid={error !== undefined}
                aria-describedby={error ? `${key}-error` : undefined}
                onBlur={() => {
                  vm.touch(key);
                }}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
              {onMove && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${label} up`}
                    disabled={i === 0}
                    onClick={() => {
                      onMove(i, -1);
                    }}
                  >
                    <ArrowUp aria-hidden="true" className="size-5" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${label} down`}
                    disabled={i === items.length - 1}
                    onClick={() => {
                      onMove(i, 1);
                    }}
                  >
                    <ArrowDown aria-hidden="true" className="size-5" />
                  </button>
                </>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${label}`}
                disabled={!canRemove()}
                onClick={() => {
                  onRemove(i);
                }}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <FieldError id={`${key}-error`} message={error} />
          </div>
        );
      })}
      {items.length < max && (
        <button type="button" className="btn-ghost self-start px-0" onClick={onAdd}>
          <Plus aria-hidden="true" className="size-5" />
          {addLabel}
        </button>
      )}
      <FieldError id={`${field}-error`} message={vm.errors[field]} />
    </fieldset>
  );
}

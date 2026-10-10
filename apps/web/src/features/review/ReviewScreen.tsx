import { Check, Undo2, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ErrorMessage, Loading } from '../shell/states';
import { CardFace, TYPE_TAGS } from './CardFace';
import { RATING_LABELS, useReview, type ReviewViewModel } from './useReview';

/** Full-screen review: no navigation, nothing top-right (§10, review-*.png). */
export function ReviewScreen() {
  const [params] = useSearchParams();
  const vm = useReview(params.get('deck'));

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="grid grid-cols-[48px_1fr_48px] items-center px-2 pt-2 lg:px-6">
        <button type="button" className="icon-btn" aria-label="End session" onClick={vm.finish}>
          <X aria-hidden="true" className="size-6" />
        </button>
        <div className="flex flex-col items-center text-center">
          <span className="truncate text-body font-medium lg:text-section">{vm.deckName}</span>
          {vm.position.total > 0 && (
            <span className="font-mono text-meta text-text-secondary" data-testid="position">
              {vm.position.current} of {vm.position.total}
            </span>
          )}
        </div>
        <span aria-hidden="true" />
      </header>
      <div
        role="progressbar"
        aria-label="Session progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(vm.progress * 100)}
        className="mt-3 h-1 w-full bg-surface-raised"
      >
        <div
          className="h-full bg-accent transition-[width] duration-150"
          style={{ width: `${String(vm.progress * 100)}%` }}
        />
      </div>

      {vm.status === 'loading' && (
        <div className="mx-auto w-full max-w-[720px] px-6">
          <Loading />
        </div>
      )}
      {vm.status === 'error' && (
        <div className="mx-auto w-full max-w-[720px] px-6">
          <ErrorMessage />
        </div>
      )}
      {vm.status === 'empty' && <EmptyState vm={vm} />}
      {vm.status === 'complete' && <Completion vm={vm} />}
      {vm.status === 'studying' && <Studying vm={vm} />}
    </div>
  );
}

function Studying({ vm }: { vm: ReviewViewModel }) {
  const type = vm.card?.content.type ?? 'basic';
  const typeTag = TYPE_TAGS[type];
  return (
    <>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 pt-8 lg:pt-16">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-sm border border-border px-3 py-1 text-meta text-text-secondary"
            data-testid="card-kind"
          >
            {vm.kind}
          </span>
          {typeTag && (
            <span
              className="rounded-sm border border-border px-3 py-1 text-meta text-text-secondary"
              data-testid="card-type"
            >
              {typeTag}
            </span>
          )}
        </div>
        <h1 className="sr-only">Review</h1>
        {vm.card && vm.answer && (
          <CardFace content={vm.card.content} answer={vm.answer} act={vm.act} disabled={vm.busy} />
        )}
        {vm.showHint && (
          <p data-testid="first-card-hint" className="text-body text-text-secondary">
            Try to recall the answer, then tap Show answer.
          </p>
        )}
      </main>

      <p role="status" className="sr-only" data-testid="announcer">
        {vm.announcement}
      </p>

      <footer className="sticky bottom-0 mx-auto flex w-full max-w-[720px] flex-col gap-4 bg-bg px-4 pb-6 pt-4">
        {vm.undoLabel && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-border bg-surface px-4 text-meta text-text-secondary"
            onClick={vm.undo}
            disabled={vm.busy}
            aria-keyshortcuts="z"
            data-testid="undo-pill"
          >
            <Undo2 aria-hidden="true" className="size-4" />
            {vm.undoLabel}
          </button>
        )}
        {vm.actionError && (
          <p role="alert" className="text-error">
            {vm.actionError}
          </p>
        )}
        <FooterActions vm={vm} />
      </footer>
    </>
  );
}

const kbd = 'hidden rounded-sm border border-on-accent/30 px-1.5 font-mono text-meta lg:inline';

/** The footer, per answer stage (§6.3): the type's primary action, Continue, or ratings. */
function FooterActions({ vm }: { vm: ReviewViewModel }) {
  const { stage, answer } = vm;
  const content = vm.card?.content;
  if (!content || !answer) return null;

  if (stage.buttons === 'none') {
    if (answer.type === 'mcq') {
      return (
        <button
          type="button"
          className="btn-primary min-h-14 text-section"
          disabled={answer.selected === null || vm.busy}
          aria-keyshortcuts="Enter"
          onClick={() => {
            vm.act({ kind: 'check' });
          }}
        >
          Check
          <kbd className={kbd}>Enter</kbd>
        </button>
      );
    }
    if (answer.type === 'cloze') {
      return (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn-primary min-h-14 text-section"
            disabled={answer.typed.trim() === '' || vm.busy}
            aria-keyshortcuts="Enter"
            onClick={() => {
              vm.act({ kind: 'check' });
            }}
          >
            Check
            <kbd className={kbd}>Enter</kbd>
          </button>
          <button type="button" className="btn-ghost text-section" onClick={vm.showAnswer}>
            Show answer
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="btn-primary min-h-14 text-section"
        onClick={vm.showAnswer}
        aria-keyshortcuts="Space"
      >
        {answer.type === 'long' ? 'Show key points' : 'Show answer'}
        <kbd className={kbd}>Space</kbd>
      </button>
    );
  }

  if (stage.buttons === 'continue') {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn-primary min-h-14 text-section"
          disabled={vm.busy}
          aria-keyshortcuts="Enter 1"
          aria-describedby="continue-note"
          onClick={() => {
            vm.rate(1);
          }}
        >
          Continue
          <kbd className={kbd}>Enter</kbd>
        </button>
        <p id="continue-note" className="text-center text-meta text-text-secondary">
          Marked as Again — you’ll see this card again soon.
        </p>
      </div>
    );
  }

  const options = vm.ratings.filter((o) => stage.ratings.includes(o.rating));
  const emphasised = stage.suggested ?? 3;
  const ticked = answer.type === 'long' ? answer.ticked.length : 0;
  const total = content.type === 'long' ? content.keyPoints.length : 0;
  return (
    <div className="flex flex-col gap-3">
      {stage.suggested !== null ? (
        <p
          role="status"
          data-testid="suggestion"
          className="text-center text-body text-text-secondary"
        >
          {ticked} of {total} key points · Suggested:{' '}
          <span className="font-semibold text-text">{RATING_LABELS[stage.suggested]}</span>
          <span className="hidden lg:inline"> (Enter)</span>
        </p>
      ) : (
        <p className="text-center text-body text-text-secondary">How well did you remember?</p>
      )}
      <div
        role="group"
        aria-label="Rate your recall"
        className={`grid gap-2 lg:gap-3 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}
      >
        {options.map((option) => {
          const suggested = stage.suggested === option.rating;
          return (
            <button
              key={option.rating}
              type="button"
              aria-label={`${option.label} · ${option.interval}${suggested ? ' · suggested' : ''}`}
              aria-keyshortcuts={answer.type === 'long' ? undefined : option.key}
              disabled={vm.busy}
              data-suggested={suggested ? 'true' : undefined}
              onClick={() => {
                vm.rate(option.rating);
              }}
              className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-lg bg-surface transition-colors duration-150 disabled:opacity-60 ${
                option.rating === emphasised ? 'border-2 border-accent' : 'border border-border'
              }`}
            >
              <span className="text-section font-semibold">{option.label}</span>
              {suggested && <span className="text-meta font-medium text-accent">Suggested</span>}
              <span className="font-mono text-meta text-text-secondary">
                {option.interval}
                {answer.type !== 'long' && (
                  <span className="hidden lg:inline"> · {option.key}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Completion({ vm }: { vm: ReviewViewModel }) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-6 px-6 py-12">
      <span
        aria-hidden="true"
        className="inline-flex size-16 items-center justify-center rounded-full border border-border text-success"
      >
        <Check className="size-7" />
      </span>
      <h1 className="text-[40px] font-semibold leading-tight tracking-tight">Review complete</h1>
      <p className="text-section font-normal text-text-secondary" data-testid="completion-text">
        {vm.completionText}
      </p>
      <dl className="flex items-center justify-between border-y border-border py-5 text-section font-normal">
        <dt className="text-text-secondary">Next cards due</dt>
        <dd data-testid="next-due">{vm.nextDueText}</dd>
      </dl>
      <button type="button" className="btn-primary min-h-14 text-section" onClick={vm.finish}>
        Back to home
      </button>
      {vm.undoLabel && (
        <button
          type="button"
          className="btn-ghost text-section text-text"
          onClick={vm.undo}
          aria-keyshortcuts="z"
        >
          <Undo2 aria-hidden="true" className="size-5" />
          Undo last rating
        </button>
      )}
    </main>
  );
}

function EmptyState({ vm }: { vm: ReviewViewModel }) {
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-page font-semibold">Nothing to study right now</h1>
      <p data-testid="review-empty" className="text-section font-normal text-text-secondary">
        New cards and reviews will show up here when they’re due.
      </p>
      <button type="button" className="btn-primary min-h-14 text-section" onClick={vm.finish}>
        Back to home
      </button>
    </main>
  );
}

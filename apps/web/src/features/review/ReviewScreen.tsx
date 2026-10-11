import { Undo2, X } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router';
import { ErrorMessage, Loading } from '../shell/states';
import { CardFace, TYPE_TAGS } from './CardFace';
import { RATING_LABELS, useReview, type ReviewViewModel } from './useReview';

/** Full-screen review: no navigation, nothing top-right (§10, review-*.png). */
export function ReviewScreen() {
  // "Do 20 more" navigates to the same URL: a new location starts a new session.
  const { key } = useLocation();
  return <ReviewSession key={key} />;
}

/** `?cap=20` (feel pass): a session of the 20 most overdue cards. */
const positiveInt = (value: string | null, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
};

function ReviewSession() {
  const [params] = useSearchParams();
  const unit = positiveInt(params.get('unit'), 1000);
  const cap = positiveInt(params.get('cap'), 500);
  const vm = useReview(params.get('deck'), unit, cap);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="grid grid-cols-[48px_1fr_48px] items-center px-2 pt-2 lg:px-6 lg:pt-3">
        <button type="button" className="icon-btn" aria-label="End session" onClick={vm.finish}>
          <X aria-hidden="true" className="size-5" />
        </button>
        <div className="flex flex-col items-center text-center">
          <span className="truncate text-small font-medium">{vm.deckName}</span>
          {vm.position.total > 0 && (
            <span className="text-meta text-text-secondary" data-testid="position">
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
        className="mt-2 h-0.5 w-full bg-surface-raised"
      >
        <div
          className="h-full bg-text-muted transition-[width] duration-150"
          style={{ width: `${String(vm.progress * 100)}%` }}
        />
      </div>

      {vm.status === 'loading' && (
        <div className="mx-auto w-full max-w-[680px] px-4 lg:px-6">
          <Loading />
        </div>
      )}
      {vm.status === 'error' && (
        <div className="mx-auto w-full max-w-[680px] px-4 lg:px-6">
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
      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 pt-6 lg:px-6 lg:pt-12">
        <h1 className="sr-only">Review</h1>
        {/* Keyed by the card on screen: each card comes in (120ms); a rated one leaves. */}
        <div
          key={vm.cardKey}
          data-testid="card"
          className={`flex flex-col gap-5 animate-card-in ${vm.leaving ? 'card-leaving' : ''}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-sm border border-border px-1.5 py-px text-meta text-text-secondary"
              data-testid="card-kind"
            >
              {vm.kind}
            </span>
            {typeTag && (
              <span
                className="rounded-sm border border-border px-1.5 py-px text-meta text-text-secondary"
                data-testid="card-type"
              >
                {typeTag}
              </span>
            )}
          </div>
          {vm.card && vm.answer && (
            <CardFace
              content={vm.card.content}
              answer={vm.answer}
              act={vm.act}
              disabled={vm.busy}
            />
          )}
          {vm.showHint && (
            <p data-testid="first-card-hint" className="text-small text-text-secondary">
              Try to recall the answer, then tap Show answer.
            </p>
          )}
        </div>
      </main>

      <p role="status" className="sr-only" data-testid="announcer">
        {vm.announcement}
      </p>

      <footer className="sticky bottom-0 mx-auto flex w-full max-w-[680px] flex-col gap-3 bg-bg px-4 pb-4 pt-3 lg:px-6 lg:pb-6">
        {vm.undoLabel && (
          <button
            type="button"
            className="group inline-flex min-h-11 items-center self-start lg:min-h-8"
            onClick={vm.undo}
            disabled={vm.busy}
            aria-keyshortcuts="z"
            data-testid="undo-pill"
          >
            {/* A small pill to look at; the button around it keeps a 44px touch target. */}
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-meta text-text-secondary transition-colors duration-150 group-hover:text-text">
              <Undo2 aria-hidden="true" className="size-3.5" />
              {vm.undoLabel}
            </span>
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
          className="btn-primary"
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
            className="btn-primary"
            disabled={answer.typed.trim() === '' || vm.busy}
            aria-keyshortcuts="Enter"
            onClick={() => {
              vm.act({ kind: 'check' });
            }}
          >
            Check
            <kbd className={kbd}>Enter</kbd>
          </button>
          <button type="button" className="btn-ghost" onClick={vm.showAnswer}>
            Show answer
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="btn-primary"
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
          className="btn-primary"
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
          className="text-center text-small text-text-secondary"
        >
          {ticked} of {total} key points · Suggested:{' '}
          <span className="font-semibold text-text">{RATING_LABELS[stage.suggested]}</span>
          <span className="hidden lg:inline"> (Enter)</span>
        </p>
      ) : (
        <p className="text-center text-small text-text-secondary">How well did you remember?</p>
      )}
      <div
        role="group"
        aria-label="Rate your recall"
        className={`grid gap-2 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}
      >
        {options.map((option) => {
          const suggested = stage.suggested === option.rating;
          const pressed = vm.pressedRating === option.rating;
          return (
            <button
              key={option.rating}
              type="button"
              aria-label={`${option.label} · ${option.interval}${suggested ? ' · suggested' : ''}`}
              aria-keyshortcuts={answer.type === 'long' ? undefined : option.key}
              disabled={vm.busy}
              data-suggested={suggested ? 'true' : undefined}
              data-pressed={pressed ? 'true' : undefined}
              onClick={() => {
                vm.rate(option.rating);
              }}
              // Pressed for 80ms (a tap, or its key), then the card leaves. The others dim.
              className={`flex min-h-[52px] flex-col items-center justify-center rounded-md bg-surface py-1.5 transition-[background-color,transform,opacity] duration-[80ms] hover:bg-surface-raised active:scale-[0.97] active:bg-surface-raised data-pressed:scale-[0.97] data-pressed:bg-surface-raised disabled:[&:not([data-pressed])]:opacity-60 ${
                option.rating === emphasised ? 'border-2 border-accent' : 'border border-border'
              }`}
            >
              <span className="text-body font-semibold">{option.label}</span>
              {/* Said in words in the line above ("Suggested: Good"); kept for screen readers. */}
              {suggested && <span className="sr-only">Suggested</span>}
              <span className="text-meta text-text-secondary">
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

/** The one restrained moment: a ring draws in, then its check (400ms). */
function CheckRing() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-12 text-success" fill="none">
      <circle
        cx="24"
        cy="24"
        r="23"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="1.5"
        transform="rotate(-90 24 24)"
        className="draw-ring"
      />
      <path
        d="M16 24.5l5.5 5.5L32.5 19"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="draw-check"
      />
    </svg>
  );
}

function Completion({ vm }: { vm: ReviewViewModel }) {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center gap-5 px-4 py-10">
      <CheckRing />
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Review complete</h1>
      <p className="text-body text-text-secondary" data-testid="completion-text">
        {vm.completionText}
      </p>
      {/* Only true numbers: from this session's reviews and the scheduler's states. */}
      <ul className="flex flex-col border-y border-border text-body">
        <li className="flex min-h-11 items-center" data-testid="remembered">
          {vm.rememberedText}
        </li>
        <li className="flex min-h-11 items-center border-t border-border" data-testid="next-due">
          {vm.nextDueText}
        </li>
        {vm.farOffText && (
          <li
            className="flex min-h-11 items-center border-t border-border text-text-secondary"
            data-testid="far-off"
          >
            {vm.farOffText}
          </li>
        )}
      </ul>
      {vm.moreLabel ? (
        // After a capped session, neither choice is the "right" one: same weight.
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-secondary" onClick={vm.more}>
            {vm.moreLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={vm.finish}>
            Done for today
          </button>
        </div>
      ) : (
        <button type="button" className="btn-primary" onClick={vm.finish}>
          Back to home
        </button>
      )}
      {vm.undoLabel && (
        <button
          type="button"
          className="btn-ghost text-text"
          onClick={vm.undo}
          aria-keyshortcuts="z"
        >
          <Undo2 aria-hidden="true" className="size-4" />
          Undo last rating
        </button>
      )}
    </main>
  );
}

function EmptyState({ vm }: { vm: ReviewViewModel }) {
  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center gap-5 px-4 py-10">
      <h1 className="text-page font-semibold">Nothing to study right now</h1>
      <p data-testid="review-empty" className="text-body text-text-secondary">
        New cards and reviews will show up here when they’re due.
      </p>
      <button type="button" className="btn-primary" onClick={vm.finish}>
        Back to home
      </button>
    </main>
  );
}

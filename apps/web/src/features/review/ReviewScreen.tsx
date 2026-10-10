import { Link, Navigate, useSearchParams } from 'react-router';
import { ErrorMessage, Loading } from '../shell/states';
import { useReview } from './useReview';

export function ReviewScreen() {
  const [params] = useSearchParams();
  const vm = useReview(params.get('deck'));

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;
  if (vm.status === 'complete') return <Navigate to={vm.completeHref} replace />;
  if (vm.status === 'empty') {
    return (
      <section aria-labelledby="review-title" className="flex flex-col gap-4">
        <h1 id="review-title" className="text-2xl font-bold">
          Study
        </h1>
        <p data-testid="review-empty">Nothing to study right now.</p>
        <Link to="/" className="btn">
          Back to Home
        </Link>
      </section>
    );
  }

  const done = vm.reviewed;
  const total = done + vm.remaining;

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <h1 id="review-title" className="sr-only">
        Study
      </h1>

      <div className="flex items-center gap-2">
        <progress
          className="h-1 flex-1"
          max={total}
          value={done}
          aria-label={`${String(vm.remaining)} cards left`}
        />
        <span data-testid="remaining">{vm.remaining} left</span>
      </div>

      <article aria-label="Card" className="flex flex-col gap-4">
        <div>
          <h2 className="sr-only">Front</h2>
          <p data-testid="card-front" className="text-xl whitespace-pre-wrap">
            {vm.card?.front}
          </p>
        </div>

        {vm.showHint && (
          <p data-testid="first-card-hint">Try to recall the answer, then tap Show answer.</p>
        )}

        {vm.revealed ? (
          <div>
            <h2 className="sr-only">Back</h2>
            <p data-testid="card-back" className="text-xl whitespace-pre-wrap">
              {vm.card?.back}
            </p>
          </div>
        ) : (
          <button type="button" className="btn text-lg" onClick={vm.showAnswer}>
            Show answer
          </button>
        )}
      </article>

      <p role="status" className="sr-only" data-testid="announcer">
        {vm.announcement}
      </p>

      {vm.revealed && (
        <div
          role="group"
          aria-label="Rate your recall"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {vm.ratings.map((option) => (
            <button
              key={option.rating}
              type="button"
              className="btn flex-col"
              disabled={vm.busy}
              aria-keyshortcuts={option.key}
              onClick={() => {
                vm.rate(option.rating);
              }}
            >
              {option.label} · {option.interval}
            </button>
          ))}
        </div>
      )}

      {vm.actionError && <p role="alert">{vm.actionError}</p>}

      <div>
        <button
          type="button"
          className="btn"
          onClick={vm.undo}
          disabled={!vm.canUndo}
          aria-keyshortcuts="z"
        >
          Undo
        </button>
      </div>
    </section>
  );
}

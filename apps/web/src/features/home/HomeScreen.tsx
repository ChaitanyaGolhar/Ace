import { ArrowRight, Plus, Search } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { DeckList } from '../../ui/DeckList';
import { useChrome } from '../shell/chrome';
import { ErrorMessage, Loading } from '../shell/states';
import { useHome, type HomeViewModel } from './useHome';
import { WelcomeScreen } from './WelcomeScreen';

export function HomeScreen() {
  const vm = useHome();
  const setChrome = useChrome();
  const welcome = vm.status === 'ready' && vm.isFirstVisit;

  useEffect(() => {
    setChrome(welcome ? 'focused' : null);
    return () => {
      setChrome(null);
    };
  }, [welcome, setChrome]);

  if (vm.status === 'loading') return <Loading />;
  if (vm.status === 'error') return <ErrorMessage />;
  if (welcome) return <WelcomeScreen />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-page font-semibold tracking-tight">{vm.greeting}</h1>
          <p className="hidden text-small text-text-secondary lg:block">
            Ready to make what you’ve learned stick?
          </p>
        </div>
        <Link
          to="/search"
          className="hidden h-8 items-center gap-2 rounded-md border border-border pl-2.5 pr-1.5 text-small text-text-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-text lg:inline-flex"
        >
          <Search aria-hidden="true" className="size-3.5" />
          Search
          <kbd className="kbd">/</kbd>
        </Link>
      </header>

      {vm.breakReturn ? (
        <BreakReturnPanel vm={vm} due={vm.breakReturn.due} />
      ) : (
        <TodayPanel vm={vm} />
      )}

      <section aria-labelledby="decks-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="decks-title" className="text-section font-semibold">
            Your decks
          </h2>
          <div className="flex items-center gap-1">
            <Link to="/decks/new" className="btn-ghost" aria-label="New deck">
              <Plus aria-hidden="true" className="size-4" />
              <span className="hidden lg:inline">New deck</span>
            </Link>
            <Link to="/decks" className="link hidden px-2 lg:inline-flex">
              View all
            </Link>
          </div>
        </div>
        <DeckList decks={vm.decks} label="Your decks" />
        <Link to="/store" className="link self-start px-2 text-small">
          <Plus aria-hidden="true" className="size-4" />
          Find decks in the store
        </Link>
      </section>
    </div>
  );
}

function TodayPanel({ vm }: { vm: HomeViewModel }) {
  return (
    <section aria-labelledby="today-title" className="panel flex flex-col gap-4 p-5">
      <h2 id="today-title" className="text-small font-medium text-text-secondary">
        Today’s study
      </h2>
      <div className="flex flex-col gap-1">
        <p className="flex items-baseline gap-2.5">
          <span className="text-hero font-semibold tracking-tight" data-testid="count-total">
            {vm.total}
          </span>
          <span className="text-section font-medium">cards to review</span>
        </p>
        <p className="text-small text-text-secondary">
          {vm.canStudy ? (
            <>
              <span data-testid="count-reviews">{vm.reviews}</span> reviews ·{' '}
              <span data-testid="count-new">{vm.newCount}</span> new
              {vm.estimateMinutes !== null && (
                <>
                  {' · about '}
                  {vm.estimateMinutes}
                  <span className="lg:hidden"> min</span>
                  <span className="hidden lg:inline">
                    {' '}
                    minute{vm.estimateMinutes === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </>
          ) : (
            <span data-testid="caught-up">You’re all caught up.</span>
          )}
        </p>
      </div>
      {vm.canStudy && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary w-full lg:w-auto"
            onClick={vm.startReviewing}
            aria-keyshortcuts="Space"
          >
            Start reviewing
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
          <span className="hidden items-center gap-1.5 text-small text-text-muted lg:inline-flex">
            or press <kbd className="kbd">Space</kbd>
          </span>
        </div>
      )}
      <p className="hidden border-t border-border pt-4 text-small text-text-muted lg:block">
        Tomorrow: <span data-testid="tomorrow-count">{vm.tomorrow}</span>{' '}
        {vm.tomorrow === 1 ? 'card' : 'cards'}. Missed a day? Nothing is lost — due cards just wait
        for you.
      </p>
    </section>
  );
}

/**
 * Coming back after a break (feel pass): the numbers, plainly, and a small way back in.
 * "Start with 20" is a session limit only; the other cards stay due, nothing changes.
 */
function BreakReturnPanel({ vm, due }: { vm: HomeViewModel; due: number }) {
  return (
    <section
      aria-labelledby="today-title"
      className="panel flex flex-col gap-4 p-5"
      data-testid="break-return"
    >
      <div className="flex flex-col gap-1">
        <h2 id="today-title" className="text-section font-semibold">
          Welcome back.
        </h2>
        <p className="text-body text-text-secondary">
          <span data-testid="break-due">{due}</span> cards are waiting — nothing is lost.
        </p>
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <button
          type="button"
          className="btn-primary w-full lg:w-auto"
          onClick={vm.startCapped}
          aria-keyshortcuts="Space"
        >
          Start with {vm.cap}
          <ArrowRight aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          className="btn-secondary w-full lg:w-auto"
          onClick={vm.startReviewing}
        >
          Review all {due}
        </button>
        <span className="hidden items-center gap-1.5 text-small text-text-muted lg:inline-flex">
          or press <kbd className="kbd">Space</kbd>
        </span>
      </div>
    </section>
  );
}

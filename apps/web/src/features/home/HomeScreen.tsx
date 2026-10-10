import { ArrowRight, Plus, Search } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { DeckList } from '../../ui/DeckList';
import { useChrome } from '../shell/chrome';
import { ErrorMessage, Loading } from '../shell/states';
import { useHome } from './useHome';
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
  if (welcome) return <WelcomeScreen vm={vm} />;

  return (
    <div className="flex flex-col gap-10 lg:gap-14">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-page font-semibold tracking-tight lg:text-[40px]">{vm.greeting}</h1>
          <p className="hidden text-body text-text-secondary lg:block lg:text-section lg:font-normal">
            Ready to make what you’ve learned stick?
          </p>
        </div>
        <Link
          to="/search"
          className="hidden min-h-11 items-center gap-3 rounded-lg border border-border px-4 text-text-secondary lg:inline-flex"
        >
          <Search aria-hidden="true" className="size-4" />
          Search
          <kbd className="kbd">/</kbd>
        </Link>
      </header>

      <section aria-labelledby="today-title" className="panel flex flex-col gap-6 p-6 lg:p-10">
        <h2 id="today-title" className="text-body font-medium text-text-secondary">
          Today’s study
        </h2>
        <div className="flex flex-col gap-3">
          <p className="flex items-baseline gap-4">
            <span
              className="font-mono text-hero font-semibold tracking-tight"
              data-testid="count-total"
            >
              {vm.total}
            </span>
            <span className="text-card font-medium">cards to review</span>
          </p>
          <p className="text-body text-text-secondary lg:text-section lg:font-normal">
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
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn-primary min-h-14 w-full text-section lg:w-auto lg:px-8"
              onClick={vm.startReviewing}
              aria-keyshortcuts="Space"
            >
              Start reviewing
              <ArrowRight aria-hidden="true" className="size-5" />
            </button>
            <span className="hidden items-center gap-2 text-body text-text-muted lg:inline-flex">
              or press <kbd className="kbd">Space</kbd>
            </span>
          </div>
        )}
        <p className="hidden border-t border-border pt-6 text-body text-text-muted lg:block">
          Tomorrow: <span data-testid="tomorrow-count">{vm.tomorrow}</span>{' '}
          {vm.tomorrow === 1 ? 'card' : 'cards'}. Missed a day? Nothing is lost — due cards just
          wait for you.
        </p>
      </section>

      <section aria-labelledby="decks-title" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="decks-title" className="text-section font-semibold lg:text-[22px]">
            Your decks
          </h2>
          <div className="flex items-center gap-2">
            <Link to="/decks/new" className="btn-ghost" aria-label="New deck">
              <Plus aria-hidden="true" className="size-5" />
              <span className="hidden lg:inline">New deck</span>
            </Link>
            <Link to="/decks" className="link hidden px-2 lg:inline-flex">
              View all
            </Link>
          </div>
        </div>
        <DeckList decks={vm.decks} label="Your decks" />
        {vm.hasReadyMade && (
          <Link to="/browse" className="link self-start px-2">
            <Plus aria-hidden="true" className="size-5" />
            Add a ready-made deck
          </Link>
        )}
      </section>
    </div>
  );
}

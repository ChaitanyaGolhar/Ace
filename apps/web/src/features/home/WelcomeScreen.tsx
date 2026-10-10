import { ArrowRight, Plus, Shield } from 'lucide-react';
import { Link } from 'react-router';
import { formatCount } from '../../services/format';
import { Logo } from '../../ui/Logo';
import type { HomeViewModel } from './useHome';

/** First visit (zero decks): one tap to a ready-made deck, or create your own. */
export function WelcomeScreen({ vm }: { vm: HomeViewModel }) {
  return (
    <div
      data-testid="welcome"
      className="flex min-h-[calc(100dvh-2rem)] flex-col gap-8 pt-4 lg:min-h-0 lg:pt-0"
    >
      <div className="lg:hidden">
        <Logo />
      </div>
      <header className="flex flex-col gap-4 pt-6">
        <h1 className="text-[44px] font-semibold leading-[1.1] tracking-tight">
          Remember what you study.
        </h1>
        <p className="text-section font-normal text-text-secondary">
          Recall brings each card back right before you’d forget it. A few minutes a day is enough.
        </p>
      </header>

      {vm.featured.length > 0 && (
        <section aria-labelledby="featured-title" className="flex flex-col gap-3">
          <h2 id="featured-title" className="text-body text-text-secondary">
            Start with a ready-made deck
          </h2>
          <ul aria-labelledby="featured-title" className="flex flex-col gap-3">
            {vm.featured.map((deck) => (
              <li key={deck.prebuiltId} className="panel flex flex-col gap-3 p-6">
                <h3 className="text-section font-semibold">{deck.name}</h3>
                <p className="text-body text-text-secondary">{deck.description}</p>
                <p className="text-body text-text-muted">
                  <span className="font-mono">{formatCount(deck.cards.length)}</span> cards
                </p>
                <button
                  type="button"
                  className="btn-primary mt-2 min-h-14 text-section"
                  onClick={() => {
                    vm.addAndStart(deck.prebuiltId);
                  }}
                  disabled={vm.adding !== null}
                >
                  Add &amp; start<span className="sr-only"> with {deck.name}</span>
                  <ArrowRight aria-hidden="true" className="size-5" />
                </button>
              </li>
            ))}
          </ul>
          {vm.addError && (
            <p role="alert" className="text-error">
              {vm.addError}
            </p>
          )}
          <Link to="/browse" className="link self-start">
            See all ready-made decks
          </Link>
        </section>
      )}

      {vm.featured.length > 0 && (
        <div className="flex items-center gap-6 text-body text-text-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      <Link to="/decks/new" className="btn-secondary min-h-14 text-section">
        <Plus aria-hidden="true" className="size-5" />
        Create your own deck
      </Link>

      <p className="mt-auto flex items-start gap-3 text-body text-text-secondary">
        <Shield aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        No account needed. Everything is saved on this device and works offline. Sign in later to
        sync.
      </p>
    </div>
  );
}

import { ArrowRight, Plus, Shield } from 'lucide-react';
import { Link } from 'react-router';
import { Logo } from '../../ui/Logo';

/** First visit (zero decks): find your subject in the store, or create your own deck. */
export function WelcomeScreen() {
  return (
    <div
      data-testid="welcome"
      className="flex min-h-[calc(100dvh-2rem)] flex-col gap-8 pt-4 lg:min-h-0 lg:pt-0"
    >
      <p className="lg:hidden">
        <Logo />
        <span className="sr-only">Ace</span>
      </p>
      <header className="flex flex-col gap-4 pt-6">
        <h1 className="text-[44px] font-semibold leading-[1.1] tracking-tight">
          Remember what you study.
        </h1>
        <p className="text-section font-normal text-text-secondary">
          Ace brings each card back right before you’d forget it. A few minutes a day is enough.
        </p>
      </header>

      <section aria-labelledby="store-title" className="flex flex-col gap-3">
        <h2 id="store-title" className="text-body text-text-secondary">
          Decks for your syllabus, ready to study
        </h2>
        <Link to="/store" className="btn-primary min-h-14 text-section">
          Find your subject
          <ArrowRight aria-hidden="true" className="size-5" />
        </Link>
      </section>

      <div className="flex items-center gap-6 text-body text-text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

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

import { ChevronLeft, Mail, Shield } from 'lucide-react';
import { Link } from 'react-router';
import { useSignIn } from './useSignIn';

export function SignInScreen() {
  const vm = useSignIn();

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-6">
      <Link to="/settings" className="btn-ghost -ml-2 self-start px-2">
        <ChevronLeft aria-hidden="true" className="size-5 text-text" />
        Settings
      </Link>

      {vm.step === 'form' ? (
        <>
          <header className="flex flex-col gap-3">
            <h1 className="text-page font-semibold tracking-tight">Sync across your devices</h1>
            <p className="text-section font-normal text-text-secondary">
              We’ll email you a sign-in link. No password to remember.
            </p>
          </header>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              vm.send();
            }}
          >
            <label className="flex flex-col gap-2 text-body font-medium text-text-secondary">
              Email
              <input
                type="email"
                className="field"
                autoComplete="email"
                value={vm.email}
                autoFocus
                aria-invalid={vm.error !== null}
                aria-describedby={vm.error ? 'signin-error' : undefined}
                onChange={(e) => {
                  vm.setEmail(e.target.value);
                }}
              />
            </label>
            {vm.error && (
              <p id="signin-error" role="alert" className="text-error">
                {vm.error}
              </p>
            )}
            <button type="submit" className="btn-primary" disabled={vm.sending}>
              {vm.sending ? 'Sending…' : 'Email me a link'}
            </button>
          </form>
        </>
      ) : (
        <section aria-labelledby="sent-title" className="flex flex-col gap-5" role="status">
          <span
            aria-hidden="true"
            className="inline-flex size-11 items-center justify-center rounded-full border border-border text-text-secondary"
          >
            <Mail className="size-5" />
          </span>
          <h1 id="sent-title" className="text-page font-semibold tracking-tight">
            Check your email
          </h1>
          <p className="text-section font-normal text-text-secondary">
            We sent a sign-in link to <span className="text-text">{vm.email.trim()}</span>. It works
            once and expires in 15 minutes.
          </p>
          {vm.error && (
            <p role="alert" className="text-error">
              {vm.error}
            </p>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={vm.sendAgain}
            disabled={vm.sending}
          >
            {vm.sending ? 'Sending…' : 'Send it again'}
          </button>
          <button type="button" className="btn-ghost" onClick={vm.useDifferentEmail}>
            Use a different email
          </button>
        </section>
      )}

      {vm.decksNote && (
        <p className="panel flex items-start gap-4 p-5 text-body text-text-secondary">
          <Shield aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {vm.decksNote}
        </p>
      )}
    </div>
  );
}

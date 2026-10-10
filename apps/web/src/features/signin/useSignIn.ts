import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { rememberSignInReturn } from '../../services/entitlements';
import { requestMagicLink, type MagicLinkResult } from '../../services/signIn';

export interface SignInViewModel {
  step: 'form' | 'sent';
  email: string;
  sending: boolean;
  error: string | null;
  /** "The 3 decks on this device stay as they are…" (null: no decks, or loading). */
  decksNote: string | null;
  setEmail: (v: string) => void;
  send: () => void;
  sendAgain: () => void;
  useDifferentEmail: () => void;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const ERRORS: Record<Exclude<MagicLinkResult, { ok: true }>['reason'], string> = {
  invalid_email: 'Enter a valid email address.',
  rate_limited: 'Too many sign-in emails. Try again in an hour.',
  network: 'Couldn’t reach the server. Check your connection and try again.',
  server: 'Something went wrong on our side. Please try again.',
};

/** The merge note, with the real number of decks on this device. */
export function decksNote(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) {
    return 'The 1 deck on this device stays as it is. After you sign in, it’s uploaded and merged with your other devices.';
  }
  return `The ${String(count)} decks on this device stay as they are. After you sign in, they’re uploaded and merged with your other devices.`;
}

export function useSignIn(): SignInViewModel {
  const { ctx } = useServices();
  const [params] = useSearchParams();
  const next = params.get('next');
  // "Sign in to unlock" (M8): come back to that store page after the magic link.
  useEffect(() => {
    if (next !== null) void rememberSignInReturn(ctx, next).catch(() => undefined);
  }, [ctx, next]);
  const [step, setStep] = useState<'form' | 'sent'>('form');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decks = useQuery(
    async () => (await ctx.db.decks.toArray()).filter((d) => d.deletedAt === null).length,
    [ctx],
  );

  const send = () => {
    if (sending) return;
    setSending(true);
    setError(null);
    void requestMagicLink(email, { apiUrl: API_URL, fetch: window.fetch.bind(window) })
      .then((result) => {
        if (result.ok) setStep('sent');
        else setError(ERRORS[result.reason]);
      })
      .finally(() => {
        setSending(false);
      });
  };

  return {
    step,
    email,
    sending,
    error,
    decksNote: decks.status === 'ready' ? decksNote(decks.data) : null,
    setEmail: (v) => {
      setEmail(v);
      setError(null);
    },
    send,
    sendAgain: send,
    useDifferentEmail: () => {
      setStep('form');
      setError(null);
    },
  };
}

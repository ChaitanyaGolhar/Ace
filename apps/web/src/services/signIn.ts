import { z } from 'zod';

export type MagicLinkResult =
  { ok: true } | { ok: false; reason: 'invalid_email' | 'rate_limited' | 'network' | 'server' };

export interface SignInOptions {
  /** Base URL of the API (VITE_API_URL). */
  apiUrl: string;
  fetch: typeof fetch;
}

const Email = z.email();

/** Asks the API (§9.1 `POST /auth/magic-link`) to email a one-time sign-in link. */
export async function requestMagicLink(
  email: string,
  { apiUrl, fetch: fetchFn }: SignInOptions,
): Promise<MagicLinkResult> {
  const trimmed = email.trim();
  if (!Email.safeParse(trimmed).success) return { ok: false, reason: 'invalid_email' };
  let res: Response;
  try {
    res = await fetchFn(`${apiUrl}/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: trimmed }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 400) return { ok: false, reason: 'invalid_email' };
  if (res.status === 429) return { ok: false, reason: 'rate_limited' };
  return { ok: false, reason: 'server' };
}

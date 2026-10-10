import { EntitlementsResponseSchema, RedeemResponseSchema } from '@recall/core';
import type { LocalDeck } from '../db/db';
import { getMeta, setMeta } from '../db/meta';
import { addCatalogDeck, type CatalogApi } from './catalog';
import type { AppContext } from './context';
import { recordEvent } from './events';

// Paid decks in the app (BUILD_BRIEF_M6_M8 §8.4): redeeming unlock codes, the account's
// entitlements, and the owner's "How to buy" text. The code a student types is sent to
// the server and never stored or recorded on the device.

export type RedeemReason = 'invalid' | 'used_up' | 'expired' | 'rate_limited' | 'network' | 'other';

export class RedeemFailedError extends Error {
  constructor(
    readonly reason: RedeemReason,
    message: string,
  ) {
    super(message);
    this.name = 'RedeemFailedError';
  }
}

/** The redemption endpoints, injectable so tests use a fake. */
export interface EntitlementsApi {
  redeem: (code: string) => Promise<{ slugs: string[] }>;
  list: () => Promise<{ slugs: string[] }>;
  purchaseInfo: () => Promise<{ instructions: string }>;
}

const REASONS: Record<string, RedeemReason> = {
  invalid_code: 'invalid',
  used_up: 'used_up',
  expired: 'expired',
  rate_limited: 'rate_limited',
};

export function httpEntitlementsApi(apiUrl: string, fetchFn: typeof fetch): EntitlementsApi {
  const call = async (path: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      res = await fetchFn(`${apiUrl}${path}`, { credentials: 'include', ...init });
    } catch {
      throw new RedeemFailedError('network', 'Couldn’t reach the server. Check your connection.');
    }
    if (!res.ok) {
      let code = 'unknown';
      let message = 'Something went wrong. Please try again.';
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        // Not JSON.
      }
      if (res.status === 401) message = 'Sign in to unlock this deck.';
      throw new RedeemFailedError(REASONS[code] ?? 'other', message);
    }
    return res.json() as Promise<unknown>;
  };
  return {
    redeem: async (code) =>
      RedeemResponseSchema.parse(
        await call('/entitlements/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }),
      ),
    list: async () => EntitlementsResponseSchema.parse(await call('/entitlements')),
    purchaseInfo: async () => {
      const body = (await call('/purchase-info')) as { instructions?: unknown };
      return { instructions: typeof body.instructions === 'string' ? body.instructions : '' };
    },
  };
}

/** Fetches and caches the account's unlocked slugs. */
export async function refreshEntitlements(
  ctx: AppContext,
  api: EntitlementsApi,
): Promise<string[]> {
  const { slugs } = await api.list();
  await setMeta(ctx.db, 'entitlements', slugs);
  return slugs;
}

export interface Redeemed {
  slugs: string[];
  /** The deck of the page the code was typed on, added at once (null if the code was for others). */
  added: LocalDeck | null;
}

/**
 * Redeems `code`, then adds the deck the student is looking at (§8.4: "On success:
 * Unlocked, and the deck is added immediately"). Records code_redeemed {slugs} or
 * code_redeem_failed {reason}, never the code.
 */
export async function redeemAndAdd(
  ctx: AppContext,
  api: EntitlementsApi,
  catalog: CatalogApi,
  code: string,
  page: { slug: string; version: number },
): Promise<Redeemed> {
  let slugs: string[];
  try {
    ({ slugs } = await api.redeem(code));
  } catch (error) {
    const reason = error instanceof RedeemFailedError ? error.reason : 'other';
    await recordEvent(ctx, 'code_redeem_failed', { reason }).catch(() => undefined);
    throw error instanceof RedeemFailedError
      ? error
      : new RedeemFailedError('other', 'Something went wrong. Please try again.');
  }
  const known = new Set([...((await getMeta(ctx.db, 'entitlements')) ?? []), ...slugs]);
  await setMeta(ctx.db, 'entitlements', [...known].sort());
  await recordEvent(ctx, 'code_redeemed', { slugs });
  const added = slugs.includes(page.slug)
    ? await addCatalogDeck(ctx, catalog, page.slug, page.version)
    : null;
  return { slugs, added };
}

/** Only pages inside the app's store can be returned to after signing in. */
const RETURNABLE = /^\/store\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Sign in to unlock": come back to this page after the magic link. */
export async function rememberSignInReturn(ctx: AppContext, path: string): Promise<void> {
  await setMeta(ctx.db, 'signInReturnTo', RETURNABLE.test(path) ? path : null);
}

/** The page to return to after signing in, once (then forgotten). */
export async function takeSignInReturn(ctx: AppContext): Promise<string | null> {
  const path = (await getMeta(ctx.db, 'signInReturnTo')) ?? null;
  if (path !== null) await setMeta(ctx.db, 'signInReturnTo', null);
  return path !== null && RETURNABLE.test(path) ? path : null;
}

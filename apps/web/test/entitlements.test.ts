import { describe, expect, it } from 'vitest';
import { summarizeDeck, validateDeckFile, type DeckFile } from '@recall/core';
import { getMeta, setMeta } from '../src/db/meta';
import { initialize } from '../src/services/bootstrap';
import type { CatalogApi } from '../src/services/catalog';
import { CatalogForbiddenError } from '../src/services/catalogHttp';
import {
  refreshEntitlements,
  RedeemFailedError,
  redeemAndAdd,
  takeSignInReturn,
  rememberSignInReturn,
  type EntitlementsApi,
} from '../src/services/entitlements';
import { makeTestContext } from './helpers';

// Paid decks in the app (BUILD_BRIEF_M6_M8 §8.4): redeeming a code adds the deck at once;
// failures are explained; events carry slugs or a reason, never the code.

const SLUG = 'sppu-te-aids-ml';
const CODE = 'ACE-7K3M-9QXR-2B';

function paidFile(): DeckFile {
  const result = validateDeckFile({
    format: 'ace-deck@2',
    slug: SLUG,
    version: 1,
    title: 'Machine Learning',
    description: 'd',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 6,
      branches: ['AIDS'],
      subject: 'Machine Learning',
      subjectCodes: { AIDS: null },
      units: [{ number: 1, title: 'Intro' }],
    },
    price: 4900,
    author: 'A',
    lastVerifiedAt: '2026-10-11',
    cards: [{ key: 'u1-001', unit: 1, type: 'basic', front: 'Q', back: 'A' }],
  });
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result.deck;
}

/** The server side: a code that unlocks SLUG once; the version needs the entitlement. */
function fakes() {
  const owned = new Set<string>();
  let used = false;
  const entitlements: EntitlementsApi = {
    redeem: (code) => {
      if (code.replace(/[\s-]/g, '').toUpperCase() !== CODE.replace(/-/g, '')) {
        return Promise.reject(new RedeemFailedError('invalid', 'This code isn’t valid'));
      }
      if (used && !owned.has(SLUG)) {
        return Promise.reject(new RedeemFailedError('used_up', 'This code has already been used'));
      }
      used = true;
      owned.add(SLUG);
      return Promise.resolve({ slugs: [SLUG] });
    },
    list: () => Promise.resolve({ slugs: [...owned] }),
    purchaseInfo: () => Promise.resolve({ instructions: 'Pay by UPI.' }),
  };
  const catalog: CatalogApi = {
    list: () => Promise.resolve({ decks: [summarizeDeck(paidFile())] }),
    detail: () => Promise.reject(new Error('unused')),
    version: (slug) =>
      owned.has(slug) ? Promise.resolve(paidFile()) : Promise.reject(new CatalogForbiddenError()),
  };
  return { entitlements, catalog, owned };
}

async function setup() {
  const ctx = makeTestContext();
  await initialize(ctx, { requestPersist: undefined });
  return { ctx, ...fakes() };
}

describe('redeemAndAdd', () => {
  it('unlocks, remembers the entitlement, adds the deck at once, and records code_redeemed', async () => {
    const { ctx, entitlements, catalog } = await setup();
    const result = await redeemAndAdd(ctx, entitlements, catalog, ' ace 7k3m 9qxr 2b ', {
      slug: SLUG,
      version: 1,
    });
    expect(result.slugs).toEqual([SLUG]);
    expect(result.added?.catalogSlug).toBe(SLUG);
    expect(await getMeta(ctx.db, 'entitlements')).toEqual([SLUG]);
    expect(await ctx.db.cards.count()).toBe(1);
    const events = await ctx.db.events.toArray();
    expect(events.map((e) => [e.type, e.props])).toEqual([
      ['code_redeemed', { slugs: [SLUG] }],
      ['catalog_deck_added', { slug: SLUG, version: 1 }],
    ]);
  });

  it('a failure records code_redeem_failed with the reason only, and adds nothing', async () => {
    const { ctx, entitlements, catalog } = await setup();
    await expect(
      redeemAndAdd(ctx, entitlements, catalog, 'ACE-0000-0000-00', { slug: SLUG, version: 1 }),
    ).rejects.toMatchObject({ reason: 'invalid', message: 'This code isn’t valid' });
    expect(await ctx.db.decks.count()).toBe(0);
    const events = await ctx.db.events.toArray();
    expect(events.map((e) => [e.type, e.props])).toEqual([
      ['code_redeem_failed', { reason: 'invalid' }],
    ]);
  });

  it('the code itself is never stored on the device (events, meta)', async () => {
    const { ctx, entitlements, catalog } = await setup();
    await redeemAndAdd(ctx, entitlements, catalog, CODE, { slug: SLUG, version: 1 });
    await redeemAndAdd(ctx, entitlements, catalog, 'ACE-1111-2222-33', {
      slug: SLUG,
      version: 1,
    }).catch(() => undefined);
    const everything = JSON.stringify([
      await ctx.db.events.toArray(),
      await ctx.db.meta.toArray(),
      await ctx.db.decks.toArray(),
    ]);
    for (const s of [CODE, '7K3M', '9QXR', 'ACE-1111-2222-33', '1111'])
      expect(everything).not.toContain(s);
  });
});

describe('entitlements on a device', () => {
  it('refreshEntitlements caches what the account owns (for "Owned — Add" on a new device)', async () => {
    const { ctx, entitlements, owned } = await setup();
    owned.add(SLUG);
    expect(await refreshEntitlements(ctx, entitlements)).toEqual([SLUG]);
    expect(await getMeta(ctx.db, 'entitlements')).toEqual([SLUG]);
  });

  it('“Sign in to unlock” comes back to the deck page, once; only store pages are accepted', async () => {
    const { ctx } = await setup();
    await rememberSignInReturn(ctx, `/store/${SLUG}`);
    expect(await takeSignInReturn(ctx)).toBe(`/store/${SLUG}`);
    expect(await takeSignInReturn(ctx)).toBeNull();
    await rememberSignInReturn(ctx, 'https://evil.example.com/');
    expect(await takeSignInReturn(ctx)).toBeNull();
    await setMeta(ctx.db, 'signInReturnTo', '//evil.example.com');
    expect(await takeSignInReturn(ctx)).toBeNull();
  });
});

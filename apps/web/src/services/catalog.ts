import {
  cardFields,
  CardSchema,
  catalogCardId,
  cardContentOf,
  contentHash,
  DeckSchema,
  initialState,
  planDeckUpdate,
  type CatalogDeckSummary,
  type CatalogDetail,
  type CatalogList,
  type DeckFile,
  type DeckUpdatePlan,
} from '@recall/core';
import type { LocalCard, LocalDeck } from '../db/db';
import { getMeta, setMeta } from '../db/meta';
import type { AppContext } from './context';
import { NotFoundError } from './errors';
import { recordEvent } from './events';

// The deck store in the app (BUILD_BRIEF_M6_M8 §7.5–7.6): the cached store list, adding
// a catalog deck, update checks, and applying an update. Network calls go through an
// injected CatalogApi; every write is one Dexie transaction.

/** The catalog endpoints, injectable so tests use a fake. */
export interface CatalogApi {
  list: () => Promise<CatalogList>;
  detail: (slug: string) => Promise<CatalogDetail>;
  /** One version's full file. */
  version: (slug: string, version: number) => Promise<DeckFile>;
}

/** No network (or the server can't be reached): adding and updating need it. */
export class CatalogOfflineError extends Error {
  constructor() {
    super('Connect to the internet to add decks.');
    this.name = 'CatalogOfflineError';
  }
}

/** At app start, and then at most this often (§7.6). */
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface StoreListing {
  decks: CatalogDeckSummary[];
  /** When the list was fetched (epoch ms). */
  fetchedAt: number;
  /** True: this is the cached list (offline). */
  offline: boolean;
}

async function rememberCatalog(ctx: AppContext, list: CatalogList): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction('rw', ctx.db.meta, async () => {
    await setMeta(ctx.db, 'catalogCache', { decks: list.decks, fetchedAt: now });
    await setMeta(
      ctx.db,
      'catalogLatest',
      Object.fromEntries(list.decks.map((d) => [d.slug, d.version])),
    );
    await setMeta(ctx.db, 'catalogCheckedAt', now);
  });
}

/** The store list: fresh when online (and cached), the cached one offline, or null. */
export async function loadStore(ctx: AppContext, api: CatalogApi): Promise<StoreListing | null> {
  try {
    const list = await api.list();
    await rememberCatalog(ctx, list);
    return { decks: list.decks, fetchedAt: ctx.now(), offline: false };
  } catch (error) {
    if (!(error instanceof CatalogOfflineError)) throw error;
    const cached = await getMeta(ctx.db, 'catalogCache');
    return cached ? { ...cached, offline: true } : null;
  }
}

/** Slugs of catalog decks the user has a live copy of. */
export async function ownedCatalogSlugs(ctx: AppContext): Promise<Set<string>> {
  const decks = await ctx.db.decks.where('catalogSlug').above('').toArray();
  return new Set(
    decks
      .filter((d) => d.deletedAt === null && d.catalogSlug !== null)
      .map((d) => d.catalogSlug ?? ''),
  );
}

/**
 * Creates the user's copy of a catalog deck version in one transaction (§7.5): one deck,
 * and one card per file card with a deterministic id, its key, content hash and unit.
 * New cards are introduced in file order (createdAt strictly increasing).
 */
export async function createCatalogDeck(ctx: AppContext, file: DeckFile): Promise<LocalDeck> {
  const { db } = ctx;
  return db.transaction('rw', [db.decks, db.cards, db.cardStates, db.events, db.meta], async () => {
    const now = ctx.now();
    const deck: LocalDeck = {
      ...DeckSchema.parse({
        id: ctx.newId(),
        name: file.title,
        source: 'catalog',
        prebuiltId: null,
        catalogSlug: file.slug,
        catalogVersion: file.version,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
      dirty: 1,
      localVersion: 1,
    };
    await db.decks.add(deck);
    const cards: LocalCard[] = file.cards.map((c, i) => {
      const content = cardContentOf(c);
      return {
        ...CardSchema.parse({
          id: catalogCardId(deck.id, c.key),
          deckId: deck.id,
          ...cardFields(content),
          unit: c.unit,
          sourceKey: c.key,
          sourceHash: contentHash(content),
          createdAt: now + i,
          updatedAt: now + i,
          deletedAt: null,
        }),
        dirty: 1,
        localVersion: 1,
      };
    });
    await db.cards.bulkAdd(cards);
    await db.cardStates.bulkPut(cards.map((c) => initialState(c)));
    await recordEvent(ctx, 'catalog_deck_added', { slug: file.slug, version: file.version });
    return deck;
  });
}

/** Downloads a version and adds it. Needs the network (CatalogOfflineError otherwise). */
export async function addCatalogDeck(
  ctx: AppContext,
  api: CatalogApi,
  slug: string,
  version: number,
): Promise<LocalDeck> {
  const file = await api.version(slug, version);
  return createCatalogDeck(ctx, file);
}

/**
 * Refreshes the latest catalog versions when due: at app start and at most every 12
 * hours (§7.6), or now with `force`. Returns whether it checked. Offline: false, quietly.
 */
export async function checkForUpdates(
  ctx: AppContext,
  api: CatalogApi,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const last = await getMeta(ctx.db, 'catalogCheckedAt');
  if (!options.force && last !== undefined && ctx.now() - last < UPDATE_CHECK_INTERVAL_MS) {
    return false;
  }
  try {
    await rememberCatalog(ctx, await api.list());
    return true;
  } catch (error) {
    if (error instanceof CatalogOfflineError) return false;
    throw error;
  }
}

export interface AvailableUpdate {
  slug: string;
  from: number;
  to: number;
}

/** From what was last seen of the catalog (no network): is a newer version out? */
export async function availableUpdate(
  ctx: AppContext,
  deckId: string,
): Promise<AvailableUpdate | null> {
  const deck = await ctx.db.decks.get(deckId);
  if (
    !deck ||
    deck.deletedAt !== null ||
    deck.catalogSlug === null ||
    deck.catalogVersion === null
  ) {
    return null;
  }
  const latest = (await getMeta(ctx.db, 'catalogLatest'))?.[deck.catalogSlug];
  if (latest === undefined || latest <= deck.catalogVersion) return null;
  return { slug: deck.catalogSlug, from: deck.catalogVersion, to: latest };
}

/** Deck ids with an update available, for the badge on deck rows. */
export async function decksWithUpdates(ctx: AppContext): Promise<Set<string>> {
  const latest = (await getMeta(ctx.db, 'catalogLatest')) ?? {};
  const decks = await ctx.db.decks.where('catalogSlug').above('').toArray();
  return new Set(
    decks
      .filter(
        (d) =>
          d.deletedAt === null &&
          d.catalogSlug !== null &&
          d.catalogVersion !== null &&
          (latest[d.catalogSlug] ?? 0) > d.catalogVersion,
      )
      .map((d) => d.id),
  );
}

export interface PlannedUpdate {
  deckId: string;
  slug: string;
  from: number;
  to: number;
  plan: DeckUpdatePlan;
}

/** Downloads the two versions and plans the update (for the banner counts and for applying). */
export async function planCatalogUpdate(
  ctx: AppContext,
  api: CatalogApi,
  deckId: string,
): Promise<PlannedUpdate | null> {
  const update = await availableUpdate(ctx, deckId);
  if (!update) return null;
  const [fromFile, toFile] = await Promise.all([
    api.version(update.slug, update.from),
    api.version(update.slug, update.to),
  ]);
  const local = await ctx.db.cards.where('deckId').equals(deckId).toArray();
  return { deckId, ...update, plan: planDeckUpdate(local, fromFile, toFile) };
}

/** Applies a planned update in one transaction (§7.6). Returns what changed, for the toast. */
export async function applyCatalogUpdate(
  ctx: AppContext,
  planned: PlannedUpdate,
): Promise<DeckUpdatePlan['applied']> {
  const { db } = ctx;
  const { plan, deckId } = planned;
  return db.transaction('rw', [db.decks, db.cards, db.cardStates, db.events, db.meta], async () => {
    const deck = await db.decks.get(deckId);
    if (!deck || deck.deletedAt !== null) throw new NotFoundError('Deck', deckId);
    const now = ctx.now();

    for (const r of plan.replace) {
      const card = await db.cards.get(r.cardId);
      if (!card || card.deletedAt !== null) continue;
      const next = CardSchema.parse({
        ...card,
        ...cardFields(r.content),
        unit: r.unit,
        sourceHash: r.sourceHash,
        updatedAt: now,
      });
      await db.cards.put({ ...next, dirty: 1, localVersion: card.localVersion + 1 });
    }

    for (const [i, a] of plan.add.entries()) {
      const id = catalogCardId(deck.id, a.key);
      if (await db.cards.get(id)) continue; // already here (e.g. from another device)
      const card = CardSchema.parse({
        id,
        deckId: deck.id,
        ...cardFields(a.content),
        unit: a.unit,
        sourceKey: a.key,
        sourceHash: a.sourceHash,
        // After every existing card, so they're introduced after the existing new cards.
        createdAt: now + i,
        updatedAt: now + i,
        deletedAt: null,
      });
      await db.cards.add({ ...card, dirty: 1, localVersion: 1 });
      await db.cardStates.put(initialState(card));
    }

    for (const r of plan.remove) {
      const card = await db.cards.get(r.cardId);
      if (!card || card.deletedAt !== null) continue;
      // Review logs are kept; only the card is tombstoned.
      await db.cards.put({
        ...card,
        deletedAt: now,
        updatedAt: now,
        dirty: 1,
        localVersion: card.localVersion + 1,
      });
    }

    await db.decks.put({
      ...deck,
      catalogVersion: planned.to,
      updatedAt: now,
      dirty: 1,
      localVersion: deck.localVersion + 1,
    });
    await recordEvent(ctx, 'deck_update_applied', {
      slug: planned.slug,
      from: planned.from,
      to: planned.to,
    });
    return plan.applied;
  });
}

const NOTHING = { fixed: 0, added: 0, removed: 0, keptEdits: 0 };

/** "Update": download, plan and apply. Nothing to do: all zeros. */
export async function updateCatalogDeck(
  ctx: AppContext,
  api: CatalogApi,
  deckId: string,
): Promise<DeckUpdatePlan['applied']> {
  const planned = await planCatalogUpdate(ctx, api, deckId);
  return planned ? applyCatalogUpdate(ctx, planned) : NOTHING;
}

/** "Updated: 12 fixed, 5 added, 2 removed, 1 kept your edits." */
export function updateToast(applied: DeckUpdatePlan['applied']): string {
  const parts = [
    `${String(applied.fixed)} fixed`,
    `${String(applied.added)} added`,
    `${String(applied.removed)} removed`,
  ];
  if (applied.keptEdits > 0) parts.push(`${String(applied.keptEdits)} kept your edits`);
  return `Updated: ${parts.join(', ')}.`;
}

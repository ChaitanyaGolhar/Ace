import { CardSchema, DeckSchema, initialState } from '@recall/core';
import type { LocalCard, LocalDeck } from '../db/db';
import type { AppContext } from './context';

/** A bundled deck (brief §11). The catalog lives in `src/content/readyMade.ts`. */
export interface ReadyMadeDeck {
  prebuiltId: string;
  name: string;
  description: string;
  version: number;
  cards: { front: string; back: string }[];
}

/**
 * Copies a ready-made deck into the user's decks: new UUIDs, `source='prebuilt'`,
 * `prebuiltId` set (§10, screen 6). One transaction. Adding the same deck again makes
 * a second, independent copy (the UI warns first).
 */
export async function addReadyMadeDeck(ctx: AppContext, source: ReadyMadeDeck): Promise<LocalDeck> {
  const { db } = ctx;
  return db.transaction('rw', [db.decks, db.cards, db.cardStates], async () => {
    const now = ctx.now();
    const deck: LocalDeck = {
      ...DeckSchema.parse({
        id: ctx.newId(),
        name: source.name,
        source: 'prebuilt',
        prebuiltId: source.prebuiltId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
      dirty: 1,
      localVersion: 1,
    };
    await db.decks.add(deck);
    // createdAt + i keeps the deck's order in the new-card queue (ordered by createdAt).
    const cards: LocalCard[] = source.cards.map((c, i) => ({
      ...CardSchema.parse({
        id: ctx.newId(),
        deckId: deck.id,
        front: c.front,
        back: c.back,
        createdAt: now + i,
        updatedAt: now + i,
        deletedAt: null,
      }),
      dirty: 1,
      localVersion: 1,
    }));
    await db.cards.bulkAdd(cards);
    await db.cardStates.bulkPut(cards.map((c) => initialState(c)));
    return deck;
  });
}

/** For each catalog deck: is a live copy already in the user's decks? */
export async function readyMadeStatus(
  ctx: AppContext,
  catalog: readonly ReadyMadeDeck[],
): Promise<Record<string, boolean>> {
  const decks = await ctx.db.decks.toArray();
  const owned = new Set(
    decks.filter((d) => d.deletedAt === null && d.prebuiltId !== null).map((d) => d.prebuiltId),
  );
  return Object.fromEntries(catalog.map((d) => [d.prebuiltId, owned.has(d.prebuiltId)]));
}

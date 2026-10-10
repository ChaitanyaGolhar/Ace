import { DeckSchema } from '@recall/core';
import type { LocalDeck } from '../db/db';
import type { AppContext } from './context';
import { NotFoundError, UserInputError } from './errors';

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new UserInputError('name', 'Deck name can’t be empty.');
  return trimmed;
}

export async function createDeck(ctx: AppContext, name: string): Promise<LocalDeck> {
  const now = ctx.now();
  const deck = DeckSchema.parse({
    id: ctx.newId(),
    name: cleanName(name),
    source: 'user',
    prebuiltId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  const row: LocalDeck = { ...deck, dirty: 1, localVersion: 1 };
  await ctx.db.decks.add(row);
  return row;
}

export async function renameDeck(ctx: AppContext, deckId: string, name: string): Promise<void> {
  const clean = cleanName(name);
  await ctx.db.transaction('rw', ctx.db.decks, async () => {
    const deck = await ctx.db.decks.get(deckId);
    // Tombstones are sticky (invariant 9): a deleted deck can't be edited.
    if (!deck || deck.deletedAt !== null) throw new NotFoundError('Deck', deckId);
    const next = { ...deck, name: clean };
    DeckSchema.parse(next);
    await ctx.db.decks.put({
      ...next,
      updatedAt: ctx.now(),
      dirty: 1,
      localVersion: deck.localVersion + 1,
    });
  });
}

/** Tombstones the deck and every live card in it, in one transaction. */
export async function deleteDeck(ctx: AppContext, deckId: string): Promise<void> {
  const { db } = ctx;
  await db.transaction('rw', [db.decks, db.cards], async () => {
    const deck = await db.decks.get(deckId);
    if (!deck) throw new NotFoundError('Deck', deckId);
    if (deck.deletedAt !== null) return; // already deleted; keep the first tombstone
    const now = ctx.now();
    await db.decks.put({
      ...deck,
      deletedAt: now,
      updatedAt: now,
      dirty: 1,
      localVersion: deck.localVersion + 1,
    });
    const cards = await db.cards.where('deckId').equals(deckId).toArray();
    for (const card of cards) {
      if (card.deletedAt !== null) continue;
      await db.cards.put({
        ...card,
        deletedAt: now,
        updatedAt: now,
        dirty: 1,
        localVersion: card.localVersion + 1,
      });
    }
  });
}

import { CardSchema, initialState, MAX_CARD_TEXT_LENGTH } from '@recall/core';
import type { LocalCard } from '../db/db';
import type { AppContext } from './context';
import { NotFoundError, UserInputError } from './errors';

export interface CardText {
  front: string;
  back: string;
}

/** Trims surrounding whitespace only; line breaks inside the text are kept. */
function cleanText({ front, back }: CardText): CardText {
  const clean = { front: front.trim(), back: back.trim() };
  if (clean.front === '') throw new UserInputError('front', 'Front can’t be empty.');
  if (clean.back === '') throw new UserInputError('back', 'Back can’t be empty.');
  const limit = `${MAX_CARD_TEXT_LENGTH.toLocaleString('en-US')} characters`;
  if (clean.front.length > MAX_CARD_TEXT_LENGTH) {
    throw new UserInputError('front', `Front can be at most ${limit}.`);
  }
  if (clean.back.length > MAX_CARD_TEXT_LENGTH) {
    throw new UserInputError('back', `Back can be at most ${limit}.`);
  }
  return clean;
}

export async function createCard(
  ctx: AppContext,
  deckId: string,
  front: string,
  back: string,
): Promise<LocalCard> {
  const text = cleanText({ front, back });
  const { db } = ctx;
  return db.transaction('rw', [db.decks, db.cards, db.cardStates], async () => {
    const deck = await db.decks.get(deckId);
    if (!deck || deck.deletedAt !== null) throw new NotFoundError('Deck', deckId);
    const now = ctx.now();
    const card = CardSchema.parse({
      id: ctx.newId(),
      deckId,
      ...text,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const row: LocalCard = { ...card, dirty: 1, localVersion: 1 };
    await db.cards.add(row);
    await db.cardStates.put(initialState(card));
    return row;
  });
}

export async function updateCard(ctx: AppContext, cardId: string, text: CardText): Promise<void> {
  const clean = cleanText(text);
  await ctx.db.transaction('rw', ctx.db.cards, async () => {
    const card = await ctx.db.cards.get(cardId);
    // Tombstones are sticky (invariant 9): a deleted card can't be edited.
    if (!card || card.deletedAt !== null) throw new NotFoundError('Card', cardId);
    if (card.front === clean.front && card.back === clean.back) return;
    const next = { ...card, ...clean };
    CardSchema.parse(next);
    await ctx.db.cards.put({
      ...next,
      updatedAt: ctx.now(),
      dirty: 1,
      localVersion: card.localVersion + 1,
    });
  });
}

export async function deleteCard(ctx: AppContext, cardId: string): Promise<void> {
  await ctx.db.transaction('rw', ctx.db.cards, async () => {
    const card = await ctx.db.cards.get(cardId);
    if (!card) throw new NotFoundError('Card', cardId);
    if (card.deletedAt !== null) return; // keep the first tombstone
    const now = ctx.now();
    await ctx.db.cards.put({
      ...card,
      deletedAt: now,
      updatedAt: now,
      dirty: 1,
      localVersion: card.localVersion + 1,
    });
  });
}

import {
  CardContentSchema,
  cardFields,
  CardSchema,
  initialState,
  type CardContent,
} from '@recall/core';
import type { LocalCard } from '../db/db';
import type { AppContext } from './context';
import { NotFoundError, UserInputError } from './errors';
import { recordEvent } from './events';

export interface CardText {
  front: string;
  back: string;
}

const tidy = (s: string) => s.trim();
const tidyOptional = (s: string | null) => (s === null || s.trim() === '' ? null : s.trim());

/**
 * Trims every text field (line breaks inside are kept), turns blank optional fields into
 * null and drops blank accepted spellings. Required fields are only trimmed, so a blank
 * one is reported by validation instead of silently disappearing.
 */
export function normalizeContent(content: CardContent): CardContent {
  switch (content.type) {
    case 'basic':
      return { type: 'basic', front: tidy(content.front), back: tidy(content.back) };
    case 'mcq':
      return {
        type: 'mcq',
        question: tidy(content.question),
        options: content.options.map((o) => ({ id: o.id, text: tidy(o.text) })),
        correct: content.correct,
        explanation: tidyOptional(content.explanation),
      };
    case 'cloze':
      return {
        type: 'cloze',
        text: tidy(content.text),
        accepted: content.accepted.map(tidy).filter((s) => s !== ''),
        hint: tidyOptional(content.hint),
        extra: tidyOptional(content.extra),
      };
    case 'short':
      return {
        type: 'short',
        question: tidy(content.question),
        answer: tidy(content.answer),
        explanation: tidyOptional(content.explanation),
      };
    case 'long':
      return {
        type: 'long',
        question: tidy(content.question),
        marks: content.marks,
        keyPoints: content.keyPoints.map(tidy),
        modelAnswer: tidyOptional(content.modelAnswer),
      };
  }
}

/** Validated, normalised content, or a UserInputError naming the field (e.g. "options.1.text"). */
export function checkContent(content: CardContent): CardContent {
  const parsed = CardContentSchema.safeParse(normalizeContent(content));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'content';
  throw new UserInputError(field, friendlyMessage(field, issue?.message ?? 'is invalid'));
}

/** Messages as the editor shows them next to the field. */
export function friendlyMessage(field: string, message: string): string {
  const name: Record<string, string> = { front: 'Question', back: 'Answer' };
  const label = name[field];
  if (label !== undefined && /blank/.test(message)) return `${label} can’t be empty.`;
  if (/too big|at most|<=/i.test(message)) {
    return label !== undefined
      ? `${label} can be at most 20,000 characters.`
      : 'This is too long (at most 5,000 characters per field).';
  }
  if (/blank/.test(message)) return 'This can’t be empty.';
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}${message.endsWith('.') ? '' : '.'}`;
}

/** Creates a card of any type (M6). One transaction with its CardState and the event. */
export async function createTypedCard(
  ctx: AppContext,
  deckId: string,
  content: CardContent,
): Promise<LocalCard> {
  const clean = checkContent(content);
  const { db } = ctx;
  return db.transaction('rw', [db.decks, db.cards, db.cardStates, db.events, db.meta], async () => {
    const deck = await db.decks.get(deckId);
    if (!deck || deck.deletedAt !== null) throw new NotFoundError('Deck', deckId);
    const now = ctx.now();
    const card = CardSchema.parse({
      id: ctx.newId(),
      deckId,
      ...cardFields(clean),
      unit: null,
      sourceKey: null,
      sourceHash: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const row: LocalCard = { ...card, dirty: 1, localVersion: 1 };
    await db.cards.add(row);
    await db.cardStates.put(initialState(card));
    await recordEvent(ctx, 'card_created', {});
    return row;
  });
}

/** A basic front/back card (the pre-M6 call). */
export function createCard(
  ctx: AppContext,
  deckId: string,
  front: string,
  back: string,
): Promise<LocalCard> {
  return createTypedCard(ctx, deckId, { type: 'basic', front, back });
}

/**
 * Replaces a card's content, possibly with another type (§6.5). The id is kept, so the
 * schedule and review history are kept too.
 */
export async function updateCardContent(
  ctx: AppContext,
  cardId: string,
  content: CardContent,
): Promise<void> {
  const clean = checkContent(content);
  await ctx.db.transaction('rw', ctx.db.cards, async () => {
    const card = await ctx.db.cards.get(cardId);
    // Tombstones are sticky (invariant 9): a deleted card can't be edited.
    if (!card || card.deletedAt !== null) throw new NotFoundError('Card', cardId);
    const next = { ...card, ...cardFields(clean) };
    if (JSON.stringify(next.content) === JSON.stringify(card.content)) return;
    CardSchema.parse(next);
    await ctx.db.cards.put({
      ...next,
      updatedAt: ctx.now(),
      dirty: 1,
      localVersion: card.localVersion + 1,
    });
  });
}

/** Edits a basic card's text (the pre-M6 call). */
export function updateCard(ctx: AppContext, cardId: string, text: CardText): Promise<void> {
  return updateCardContent(ctx, cardId, { type: 'basic', ...text });
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

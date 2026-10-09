import { mergeLog } from './merge';
import { initialState } from './scheduler';
import type { Card, Deck, ReviewLog } from './schemas';
import { endOfStudyDay, studyDayKey } from './studyDay';
import type { CardState, UUID } from './types';

/** A learning card due within this window is offered early when nothing else is due. */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

export interface QueueInput {
  /**
   * Not in the brief's draft signature: needed so cards of a tombstoned deck never
   * appear (invariant 6), even if a card row itself was not tombstoned (e.g. a
   * newer edit to the card from another device won its own LWW).
   */
  decks: Deck[];
  cards: Card[];
  /** Cards with no entry are treated as new (their `initialState`). */
  states: Map<UUID, CardState>;
  /** All review logs, across all decks: the new-card limit is global. */
  logs: ReviewLog[];
  now: number;
  timeZone: string;
  rolloverHour: number;
  newPerDay: number;
  /** Optional filter: only this deck's cards. */
  deckId?: UUID;
}

export interface Queue {
  /**
   * Cards to study now, ordered by due ascending: review cards due at any time in the
   * current study day, plus learning/relearning cards whose due time has passed.
   */
  due: UUID[];
  /** New cards allowed today, ordered by createdAt ascending. */
  newCards: UUID[];
  /** When nothing is due: the earliest learning card due within 20 minutes. */
  learnAheadNext: { cardId: UUID; due: number } | null;
  /**
   * Disjoint counts for the Home screen: `due` = review cards due today,
   * `learning` = learning/relearning cards due now, `new` = newCards.length.
   */
  counts: { due: number; new: number; learning: number };
}

const byDueThenId = (a: CardState, b: CardState) =>
  a.due - b.due || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);

const byCreatedThenId = (a: Card, b: Card) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildQueue(input: QueueInput): Queue {
  const { now, newPerDay, timeZone, rolloverHour } = input;
  if (!Number.isInteger(newPerDay) || newPerDay < 0) {
    throw new RangeError(`newPerDay must be a non-negative integer, got ${String(newPerDay)}`);
  }

  const liveDeckIds = new Set(
    input.decks.filter((deck) => deck.deletedAt === null).map((deck) => deck.id),
  );
  const cards = input.cards.filter(
    (card) =>
      card.deletedAt === null &&
      liveDeckIds.has(card.deckId) &&
      (input.deckId === undefined || card.deckId === input.deckId),
  );
  const stateOf = (card: Card) => input.states.get(card.id) ?? initialState(card);

  // Review cards are scheduled in whole days, so they are due for the whole study day
  // they fall in: a card due at 23:00 can be studied in the morning. Learning steps
  // are minutes long, so learning/relearning cards wait for their exact due time.
  const endOfToday = endOfStudyDay(now, timeZone, rolloverHour);
  const isDue = (s: CardState) =>
    s.state === 'review' ? s.due <= endOfToday : s.state !== 'new' && s.due <= now;
  const dueStates = cards.map(stateOf).filter(isDue).sort(byDueThenId);

  const allowance = Math.max(0, newPerDay - countIntroducedToday(input));
  const newCards = cards
    .filter((card) => stateOf(card).state === 'new')
    .sort(byCreatedThenId)
    .slice(0, allowance)
    .map((card) => card.id);

  let learnAheadNext: Queue['learnAheadNext'] = null;
  if (dueStates.length === 0) {
    const next = cards
      .map(stateOf)
      .filter(
        (s) =>
          (s.state === 'learning' || s.state === 'relearning') && s.due <= now + LEARN_AHEAD_MS,
      )
      .sort(byDueThenId)[0];
    if (next !== undefined) learnAheadNext = { cardId: next.cardId, due: next.due };
  }

  const learningDue = dueStates.filter((s) => s.state !== 'review').length;
  return {
    due: dueStates.map((s) => s.cardId),
    newCards,
    learnAheadNext,
    counts: { due: dueStates.length - learningDue, learning: learningDue, new: newCards.length },
  };
}

/**
 * How many cards were introduced (first reviewed) during the current study day.
 * A card's first review is its earliest non-voided log, so undoing a new card's
 * first review frees its slot again. Deleted cards still count: deleting a card
 * you studied today doesn't hand out an extra new card.
 */
function countIntroducedToday(input: QueueInput): number {
  const { logs, now, timeZone, rolloverHour } = input;

  // Merge duplicate copies first, so a log voided in any copy counts as voided.
  const byId = new Map<string, ReviewLog>();
  for (const log of logs) {
    const existing = byId.get(log.id);
    byId.set(log.id, existing === undefined ? log : mergeLog(existing, log));
  }

  const firstReviewAt = new Map<UUID, number>();
  for (const log of byId.values()) {
    if (log.voidedAt !== null) continue;
    const seen = firstReviewAt.get(log.cardId);
    if (seen === undefined || log.reviewedAt < seen) firstReviewAt.set(log.cardId, log.reviewedAt);
  }

  const today = studyDayKey(now, timeZone, rolloverHour);
  // A study day lasts at most ~25h, so anything older than 48h can't be today. This
  // skips the (relatively slow) Intl call for most cards in a large collection.
  const cutoff = now - 48 * 60 * 60 * 1000;
  let count = 0;
  for (const at of firstReviewAt.values()) {
    if (at > cutoff && studyDayKey(at, timeZone, rolloverHour) === today) count++;
  }
  return count;
}

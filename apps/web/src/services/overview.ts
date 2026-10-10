import {
  buildQueue,
  endOfStudyDay,
  initialState,
  studyDayKey,
  type CardState,
  type Queue,
} from '@recall/core';
import type { LocalCard, LocalDeck, LocalReviewLog } from '../db/db';
import type { AppContext } from './context';
import { ESTIMATE_SAMPLE_SIZE, estimateStudyMinutes } from './estimate';
import { loadQueueInput, type LocalQueueInput } from './queue';

interface Options {
  browserTimeZone: string;
}

export interface DeckSummary {
  id: string;
  name: string;
  source: 'user' | 'prebuilt';
  /** Live cards in the deck. */
  cardCount: number;
  counts: Queue['counts'];
}

export interface HomeData {
  counts: Queue['counts'];
  decks: DeckSummary[];
  /** Cards (not new) that will be due during tomorrow's study day. */
  tomorrow: number;
  /** "About N minutes" for today's cards, or null with too little review history. */
  estimateMinutes: number | null;
}

function liveDecks(input: LocalQueueInput): LocalDeck[] {
  return input.decks
    .filter((d) => d.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** States of live cards in live decks (invariant 6: tombstones never count). */
function liveStates(input: LocalQueueInput): { card: LocalCard; state: CardState }[] {
  const liveDeckIds = new Set(input.decks.filter((d) => d.deletedAt === null).map((d) => d.id));
  return input.cards
    .filter((c) => c.deletedAt === null && liveDeckIds.has(c.deckId))
    .map((card) => ({ card, state: input.states.get(card.id) ?? initialState(card) }));
}

/** The latest non-undone reviews, newest first (enough for the Home estimate). */
async function latestReviews(ctx: AppContext, n: number): Promise<LocalReviewLog[]> {
  return ctx.db.reviewLogs
    .orderBy('reviewedAt')
    .reverse()
    .filter((l) => l.voidedAt === null)
    .limit(n)
    .toArray();
}

export async function loadHome(ctx: AppContext, options: Options): Promise<HomeData> {
  const [input, latest] = await Promise.all([
    loadQueueInput(ctx, options.browserTimeZone, { logs: 'newLimit' }),
    latestReviews(ctx, ESTIMATE_SAMPLE_SIZE),
  ]);
  const { now, timeZone, rolloverHour } = input;
  const counts = buildQueue(input).counts;
  const live = liveStates(input);
  const endOfToday = endOfStudyDay(now, timeZone, rolloverHour);
  const endOfTomorrow = endOfStudyDay(endOfToday, timeZone, rolloverHour);
  return {
    counts,
    // The new-card limit is global, so each deck's "new" is what it could offer today
    // if studied on its own.
    decks: liveDecks(input).map((deck) => ({
      id: deck.id,
      name: deck.name,
      source: deck.source,
      cardCount: live.filter(({ card }) => card.deckId === deck.id).length,
      counts: buildQueue({ ...input, deckId: deck.id }).counts,
    })),
    tomorrow: live.filter(
      ({ state }) => state.state !== 'new' && state.due >= endOfToday && state.due < endOfTomorrow,
    ).length,
    estimateMinutes: estimateStudyMinutes(latest, counts.due + counts.learning + counts.new),
  };
}

export interface DeckViewData {
  deck: LocalDeck;
  /** Live cards, oldest first, each with its scheduling state. */
  cards: (LocalCard & { state: CardState })[];
  counts: Queue['counts'];
  /** Latest non-undone review of any card in the deck, or null. */
  lastStudiedAt: number | null;
  /** Effective study-day settings, for due labels. */
  timeZone: string;
  rolloverHour: number;
  now: number;
}

export async function loadDeckView(
  ctx: AppContext,
  deckId: string,
  options: Options,
): Promise<DeckViewData | null> {
  const input = await loadQueueInput(ctx, options.browserTimeZone, { logs: 'newLimit' });
  const deck = input.decks.find((d) => d.id === deckId);
  if (!deck || deck.deletedAt !== null) return null;
  const cards = input.cards
    .filter((c) => c.deckId === deckId && c.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .map((card) => ({ ...card, state: input.states.get(card.id) ?? initialState(card) }));
  const cardIds = new Set(cards.map((c) => c.id));
  // Newest first through the reviewedAt index; stops at the deck's latest review.
  const latest = await ctx.db.reviewLogs
    .orderBy('reviewedAt')
    .reverse()
    .filter((l) => l.voidedAt === null && cardIds.has(l.cardId))
    .first();
  const lastStudiedAt = latest?.reviewedAt ?? null;
  return {
    deck,
    cards,
    counts: buildQueue({ ...input, deckId }).counts,
    lastStudiedAt,
    timeZone: input.timeZone,
    rolloverHour: input.rolloverHour,
    now: input.now,
  };
}

/** Case-insensitive substring search over front and back. */
export function searchCards<T extends { front: string; back: string }>(
  cards: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return cards;
  return cards.filter((c) => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q));
}

export type NextDue =
  | { kind: 'none' }
  | { kind: 'laterToday'; count: number }
  | { kind: 'tomorrow'; count: number }
  | { kind: 'later'; day: string; count: number };

/** "When are the next cards due?" for the session-complete screen. */
export async function loadNextDue(ctx: AppContext, options: Options): Promise<NextDue> {
  const input = await loadQueueInput(ctx, options.browserTimeZone, { logs: 'newLimit' });
  const { now, timeZone, rolloverHour } = input;
  const liveDeckIds = new Set(liveDecks(input).map((d) => d.id));
  const dues = input.cards
    .filter((c) => c.deletedAt === null && liveDeckIds.has(c.deckId))
    .map((c) => input.states.get(c.id) ?? initialState(c))
    .filter((s) => s.state !== 'new')
    .map((s) => s.due);
  if (dues.length === 0) return { kind: 'none' };

  const endOfToday = endOfStudyDay(now, timeZone, rolloverHour);
  const laterToday = dues.filter((due) => due < endOfToday).length;
  if (laterToday > 0) return { kind: 'laterToday', count: laterToday };

  const endOfTomorrow = endOfStudyDay(endOfToday, timeZone, rolloverHour);
  const tomorrow = dues.filter((due) => due < endOfTomorrow).length;
  if (tomorrow > 0) return { kind: 'tomorrow', count: tomorrow };

  const first = Math.min(...dues);
  const end = endOfStudyDay(first, timeZone, rolloverHour);
  return {
    kind: 'later',
    day: studyDayKey(first, timeZone, rolloverHour),
    count: dues.filter((due) => due < end).length,
  };
}

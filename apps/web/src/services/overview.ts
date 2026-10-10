import { buildQueue, endOfStudyDay, initialState, studyDayKey, type Queue } from '@recall/core';
import type { LocalCard, LocalDeck } from '../db/db';
import type { AppContext } from './context';
import { loadQueueInput, type LocalQueueInput } from './queue';

interface Options {
  browserTimeZone: string;
}

export interface DeckSummary {
  id: string;
  name: string;
  counts: Queue['counts'];
}

export interface HomeData {
  counts: Queue['counts'];
  decks: DeckSummary[];
}

function liveDecks(input: LocalQueueInput): LocalDeck[] {
  return input.decks
    .filter((d) => d.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function loadHome(ctx: AppContext, options: Options): Promise<HomeData> {
  const input = await loadQueueInput(ctx, options.browserTimeZone);
  return {
    counts: buildQueue(input).counts,
    // The new-card limit is global, so each deck's "new" is what it could offer today
    // if studied on its own.
    decks: liveDecks(input).map((deck) => ({
      id: deck.id,
      name: deck.name,
      counts: buildQueue({ ...input, deckId: deck.id }).counts,
    })),
  };
}

export interface DeckViewData {
  deck: LocalDeck;
  /** Live cards, oldest first. */
  cards: LocalCard[];
  counts: Queue['counts'];
}

export async function loadDeckView(
  ctx: AppContext,
  deckId: string,
  options: Options,
): Promise<DeckViewData | null> {
  const input = await loadQueueInput(ctx, options.browserTimeZone);
  const deck = input.decks.find((d) => d.id === deckId);
  if (!deck || deck.deletedAt !== null) return null;
  const cards = input.cards
    .filter((c) => c.deckId === deckId && c.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return { deck, cards, counts: buildQueue({ ...input, deckId }).counts };
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
  const input = await loadQueueInput(ctx, options.browserTimeZone);
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

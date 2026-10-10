import { buildQueue, type Queue, type QueueInput } from '@recall/core';
import type { LocalCard, LocalDeck, LocalReviewLog } from '../db/db';
import type { AppContext } from './context';
import { effectiveTimeZone, getSettings } from './settings';

export interface LoadQueueOptions {
  browserTimeZone: string;
  /** Scope to one deck; all decks when omitted. */
  deckId?: string;
}

/** QueueInput, keeping the local row types (with dirty/localVersion) for callers that need them. */
export interface LocalQueueInput extends QueueInput {
  decks: LocalDeck[];
  cards: LocalCard[];
  logs: LocalReviewLog[];
}

/** Reads everything buildQueue needs from IndexedDB, in one read transaction. */
export async function loadQueueInput(
  ctx: AppContext,
  browserTimeZone: string,
): Promise<LocalQueueInput> {
  const { db } = ctx;
  const settings = await getSettings(ctx);
  return db.transaction('r', [db.decks, db.cards, db.cardStates, db.reviewLogs], async () => {
    const [decks, cards, states, logs] = await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
      db.cardStates.toArray(),
      db.reviewLogs.toArray(),
    ]);
    return {
      decks,
      cards,
      states: new Map(states.map((s) => [s.cardId, s])),
      logs,
      now: ctx.now(),
      timeZone: effectiveTimeZone(settings, browserTimeZone),
      rolloverHour: settings.rolloverHour,
      newPerDay: settings.newPerDay,
    };
  });
}

export async function loadQueue(ctx: AppContext, options: LoadQueueOptions): Promise<Queue> {
  const input = await loadQueueInput(ctx, options.browserTimeZone);
  return buildQueue(options.deckId === undefined ? input : { ...input, deckId: options.deckId });
}

export interface NextCard {
  cardId: string;
  kind: 'due' | 'new' | 'learnAhead';
}

/** Session order (§6.1): due cards first, then new cards, then a learn-ahead card. */
export function nextCard(queue: Queue): NextCard | null {
  const due = queue.due[0];
  if (due !== undefined) return { cardId: due, kind: 'due' };
  const fresh = queue.newCards[0];
  if (fresh !== undefined) return { cardId: fresh, kind: 'new' };
  if (queue.learnAheadNext) return { cardId: queue.learnAheadNext.cardId, kind: 'learnAhead' };
  return null;
}

/** Cards left in the session, for the progress indicator. */
export function remainingCount(queue: Queue): number {
  const n = queue.due.length + queue.newCards.length;
  return n === 0 && queue.learnAheadNext ? 1 : n;
}

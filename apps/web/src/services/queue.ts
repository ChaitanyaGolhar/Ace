import { buildQueue, type Queue } from '@recall/core';
import type { AppContext } from './context';
import { effectiveTimeZone, getSettings } from './settings';

export interface LoadQueueOptions {
  browserTimeZone: string;
  /** Scope to one deck; all decks when omitted. */
  deckId?: string;
}

/** Reads everything buildQueue needs from IndexedDB, in one read transaction. */
export async function loadQueue(ctx: AppContext, options: LoadQueueOptions): Promise<Queue> {
  const { db } = ctx;
  const settings = await getSettings(ctx);
  return db.transaction('r', [db.decks, db.cards, db.cardStates, db.reviewLogs], async () => {
    const [decks, cards, states, logs] = await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
      db.cardStates.toArray(),
      db.reviewLogs.toArray(),
    ]);
    return buildQueue({
      decks,
      cards,
      states: new Map(states.map((s) => [s.cardId, s])),
      logs,
      now: ctx.now(),
      timeZone: effectiveTimeZone(settings, options.browserTimeZone),
      rolloverHour: settings.rolloverHour,
      newPerDay: settings.newPerDay,
      ...(options.deckId === undefined ? {} : { deckId: options.deckId }),
    });
  });
}

export type NextCard = { cardId: string; kind: 'due' | 'new' | 'learnAhead' };

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

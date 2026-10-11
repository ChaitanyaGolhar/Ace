import { buildQueue, type Queue, type QueueInput } from '@recall/core';
import type { LocalCard, LocalDeck, LocalReviewLog, RecallDB } from '../db/db';
import type { AppContext } from './context';
import { effectiveTimeZone, getSettings } from './settings';

export interface LoadQueueOptions {
  browserTimeZone: string;
  /** Scope to one deck; all decks when omitted. */
  deckId?: string;
  /** M7 (§7.7): only this syllabus unit (with deckId). */
  unit?: number;
}

/** QueueInput, keeping the local row types (with dirty/localVersion) for callers that need them. */
export interface LocalQueueInput extends QueueInput {
  decks: LocalDeck[];
  cards: LocalCard[];
  logs: LocalReviewLog[];
}

export interface LoadQueueInputOptions {
  /**
   * `all` (default): the whole review log (Stats needs it).
   * `newLimit`: only what `buildQueue` needs — the full history of cards reviewed in
   * the last 48 hours. Core counts a card as introduced today only if its first review
   * is within 48 h of now, so the queue is identical, and a big collection's log isn't
   * read on every screen (DECISIONS D-317).
   */
  logs?: 'all' | 'newLimit';
}

const NEW_LIMIT_WINDOW_MS = 48 * 60 * 60 * 1000;

async function logsForNewLimit(db: RecallDB, now: number): Promise<LocalReviewLog[]> {
  const recent = await db.reviewLogs
    .where('reviewedAt')
    .aboveOrEqual(now - NEW_LIMIT_WINDOW_MS)
    .toArray();
  const cardIds = [...new Set(recent.map((l) => l.cardId))];
  return cardIds.length === 0 ? [] : db.reviewLogs.where('cardId').anyOf(cardIds).toArray();
}

/** Reads everything buildQueue needs from IndexedDB, in one read transaction. */
export async function loadQueueInput(
  ctx: AppContext,
  browserTimeZone: string,
  options: LoadQueueInputOptions = {},
): Promise<LocalQueueInput> {
  const { db } = ctx;
  const settings = await getSettings(ctx);
  const now = ctx.now();
  return db.transaction('r', [db.decks, db.cards, db.cardStates, db.reviewLogs], async () => {
    const [decks, cards, states, logs] = await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
      db.cardStates.toArray(),
      options.logs === 'newLimit' ? logsForNewLimit(db, now) : db.reviewLogs.toArray(),
    ]);
    return {
      decks,
      cards,
      states: new Map(states.map((s) => [s.cardId, s])),
      logs,
      now,
      timeZone: effectiveTimeZone(settings, browserTimeZone),
      rolloverHour: settings.rolloverHour,
      newPerDay: settings.newPerDay,
    };
  });
}

export async function loadQueue(ctx: AppContext, options: LoadQueueOptions): Promise<Queue> {
  const input = await loadQueueInput(ctx, options.browserTimeZone, { logs: 'newLimit' });
  return buildQueue({
    ...input,
    ...(options.deckId === undefined ? {} : { deckId: options.deckId }),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
  });
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

/**
 * A capped session's queue (feel pass): only the capped cards, in queue order, and no
 * new cards. `counts` stay the whole day's. The schedule itself is untouched.
 */
export function capQueue(queue: Queue, cap: readonly string[]): Queue {
  const allowed = new Set(cap);
  const next = queue.learnAheadNext;
  return {
    ...queue,
    due: queue.due.filter((id) => allowed.has(id)),
    newCards: [],
    learnAheadNext: next && allowed.has(next.cardId) ? next : null,
  };
}

/** Cards left in the session, for the progress indicator. */
export function remainingCount(queue: Queue): number {
  const n = queue.due.length + queue.newCards.length;
  return n === 0 && queue.learnAheadNext ? 1 : n;
}

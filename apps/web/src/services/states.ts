import { replay, type CardState } from '@recall/core';
import type { LocalCard, LocalReviewLog } from '../db/db';
import type { AppContext } from './context';

/** Replays one card from its logs. Callers run this inside their own transaction. */
export async function recomputeCardState(ctx: AppContext, card: LocalCard): Promise<CardState> {
  const logs = await ctx.db.reviewLogs.where('cardId').equals(card.id).toArray();
  const state = replay(card, logs);
  await ctx.db.cardStates.put(state);
  return state;
}

/** Rebuilds every CardState from the review log (the migration strategy, invariant 8). */
export async function rebuildAllCardStates(ctx: AppContext): Promise<void> {
  const { db } = ctx;
  await db.transaction('rw', [db.cards, db.reviewLogs, db.cardStates], async () => {
    const [cards, logs] = await Promise.all([db.cards.toArray(), db.reviewLogs.toArray()]);
    const logsByCard = new Map<string, LocalReviewLog[]>();
    for (const log of logs) {
      const list = logsByCard.get(log.cardId);
      if (list) list.push(log);
      else logsByCard.set(log.cardId, [log]);
    }
    await db.cardStates.bulkPut(cards.map((card) => replay(card, logsByCard.get(card.id) ?? [])));
  });
}

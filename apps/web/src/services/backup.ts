import { CardSchema, DeckSchema, lww, mergeLog, replay, ReviewLogSchema } from '@recall/core';
import { z } from 'zod';
import { withoutSyncFields, type LocalCard, type LocalDeck, type LocalReviewLog } from '../db/db';
import type { AppContext } from './context';
import { sameRow } from './rows';

// Export/import backup (brief §10 screen 8, M3). Import merges with exactly the rules
// sync uses: decks/cards by `lww` (tombstones are sticky), logs by `mergeLog` (undos
// stick). So importing is idempotent and never deletes or reverts anything newer.

export const BackupSchema = z.object({
  format: z.literal('recall-backup'),
  version: z.literal(1),
  exportedAt: z.int().nonnegative(),
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
});

export type Backup = z.infer<typeof BackupSchema>;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export async function exportBackup(ctx: AppContext): Promise<Backup> {
  const { db } = ctx;
  return db.transaction('r', [db.decks, db.cards, db.reviewLogs], async () => ({
    format: 'recall-backup' as const,
    version: 1 as const,
    exportedAt: ctx.now(),
    decks: (await db.decks.toArray()).map(withoutSyncFields),
    cards: (await db.cards.toArray()).map(withoutSyncFields),
    reviewLogs: (await db.reviewLogs.toArray()).map(withoutSyncFields),
  }));
}

export interface ImportResult {
  /** Rows added or changed, per table. */
  decks: number;
  cards: number;
  reviewLogs: number;
}

export async function importBackup(ctx: AppContext, data: unknown): Promise<ImportResult> {
  const parsed = BackupSchema.safeParse(data);
  if (!parsed.success) {
    throw new BackupError('This file isn’t a valid backup, so nothing was imported.');
  }
  const backup = parsed.data;
  const { db } = ctx;
  return db.transaction('rw', [db.decks, db.cards, db.reviewLogs, db.cardStates], async () => {
    const result: ImportResult = { decks: 0, cards: 0, reviewLogs: 0 };
    const affectedCards = new Set<string>();

    for (const incoming of backup.decks) {
      const local = await db.decks.get(incoming.id);
      const current = local ? withoutSyncFields(local) : null;
      const winner = current ? lww(current, incoming) : incoming;
      if (current && sameRow(winner, current)) continue;
      const row: LocalDeck = { ...winner, dirty: 1, localVersion: (local?.localVersion ?? 0) + 1 };
      await db.decks.put(row);
      result.decks += 1;
    }

    for (const incoming of backup.cards) {
      const local = await db.cards.get(incoming.id);
      const current = local ? withoutSyncFields(local) : null;
      const winner = current ? lww(current, incoming) : incoming;
      if (current && sameRow(winner, current)) continue;
      const row: LocalCard = { ...winner, dirty: 1, localVersion: (local?.localVersion ?? 0) + 1 };
      await db.cards.put(row);
      affectedCards.add(row.id);
      result.cards += 1;
    }

    for (const incoming of backup.reviewLogs) {
      const local = await db.reviewLogs.get(incoming.id);
      const current = local ? withoutSyncFields(local) : null;
      const merged = current ? mergeLog(current, incoming) : incoming;
      if (current && sameRow(merged, current)) continue;
      const row: LocalReviewLog = {
        ...merged,
        dirty: 1,
        localVersion: (local?.localVersion ?? 0) + 1,
      };
      await db.reviewLogs.put(row);
      affectedCards.add(row.cardId);
      result.reviewLogs += 1;
    }

    // Re-derive the scheduling state of every card whose card row or logs changed.
    for (const cardId of affectedCards) {
      const card = await db.cards.get(cardId);
      if (!card) continue;
      const logs = await db.reviewLogs.where('cardId').equals(cardId).toArray();
      await db.cardStates.put(replay(card, logs));
    }
    return result;
  });
}

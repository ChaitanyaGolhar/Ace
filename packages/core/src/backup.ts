import { z } from 'zod';
import { CardSchema, DeckSchema, ReviewLogSchema } from './schemas';

/**
 * The backup file (brief §10 screen 8; DECISIONS D-309): every deck, card and review
 * log, including tombstones and undone logs, without local-only fields. Importing merges
 * with the sync rules (`lww`, `mergeLog`), so it is idempotent.
 */
export const BackupSchema = z.object({
  format: z.literal('recall-backup'),
  version: z.literal(1),
  exportedAt: z.int().nonnegative(),
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
});

export type Backup = z.infer<typeof BackupSchema>;

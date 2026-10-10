import { z } from 'zod';
import {
  cardFields,
  CardSchema,
  DeckSchema,
  MAX_CARD_TEXT_LENGTH,
  ReviewLogSchema,
} from './schemas';

/**
 * The backup file (brief §10 screen 8; DECISIONS D-309): every deck, card and review
 * log, including tombstones and undone logs, without local-only fields. Importing merges
 * with the sync rules (`lww`, `mergeLog`), so it is idempotent.
 *
 * Version 2 (M6) holds typed cards and review outcomes. Version 1 files, exported before
 * M6, still import: their cards become basic cards with the same front/back.
 */
const BackupV2Schema = z.object({
  format: z.literal('recall-backup'),
  version: z.literal(2),
  exportedAt: z.int().nonnegative(),
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
});

const LegacyCardSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  front: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
  back: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
  deletedAt: z.int().nonnegative().nullable(),
});

const BackupV1Schema = z.object({
  format: z.literal('recall-backup'),
  version: z.literal(1),
  exportedAt: z.int().nonnegative(),
  decks: z.array(DeckSchema),
  cards: z.array(LegacyCardSchema),
  reviewLogs: z.array(ReviewLogSchema),
});

export const BackupSchema = z.union([
  BackupV2Schema,
  BackupV1Schema.transform((v1, ctx) => {
    const upgraded = BackupV2Schema.safeParse({
      ...v1,
      version: 2,
      cards: v1.cards.map(({ front, back, ...rest }) => ({
        ...rest,
        ...cardFields({ type: 'basic', front, back }),
      })),
    });
    if (!upgraded.success) {
      for (const issue of upgraded.error.issues) ctx.addIssue({ ...issue, code: 'custom' });
      return z.NEVER;
    }
    return upgraded.data;
  }),
]);

export type Backup = z.infer<typeof BackupV2Schema>;
export const BACKUP_VERSION = 2;

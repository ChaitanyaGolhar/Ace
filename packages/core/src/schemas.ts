import { z } from 'zod';

// Synced entities. These schemas are the single definition of the wire format:
// the TypeScript types below are inferred from them, so the two can never drift.
//
// Unknown keys are stripped (zod's default), so local-only fields such as `dirty`
// and `localVersion` can never reach the server through a parsed row.

export const MAX_DECK_NAME_LENGTH = 200;
export const MAX_CARD_TEXT_LENGTH = 20_000;

export const Uuid = z.uuid({ version: 'v7' });
/** Epoch milliseconds. `z.int()` also restricts to safe integers. */
const EpochMs = z.int().nonnegative();

export const DeckSchema = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(MAX_DECK_NAME_LENGTH),
    source: z.enum(['user', 'prebuilt']),
    prebuiltId: z.string().min(1).nullable(),
    createdAt: EpochMs,
    updatedAt: EpochMs,
    deletedAt: EpochMs.nullable(),
  })
  .refine((deck) => (deck.source === 'prebuilt') === (deck.prebuiltId !== null), {
    message: 'prebuiltId must be set exactly when source is "prebuilt"',
    path: ['prebuiltId'],
  });

export const CardSchema = z.object({
  id: Uuid,
  deckId: Uuid,
  front: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
  back: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
  createdAt: EpochMs,
  updatedAt: EpochMs,
  deletedAt: EpochMs.nullable(),
});

export const RatingSchema = z.literal([1, 2, 3, 4]);

export const ReviewLogSchema = z.object({
  id: Uuid,
  cardId: Uuid,
  rating: RatingSchema,
  reviewedAt: EpochMs,
  durationMs: z.int().nonnegative(),
  deviceId: z.string().min(1).max(100),
  voidedAt: EpochMs.nullable(),
});

export type Deck = z.infer<typeof DeckSchema>;
export type Card = z.infer<typeof CardSchema>;
export type ReviewLog = z.infer<typeof ReviewLogSchema>;
export type Rating = z.infer<typeof RatingSchema>;

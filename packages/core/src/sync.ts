import { z } from 'zod';
import { CardSchema, DeckSchema, ReviewLogSchema, Uuid } from './schemas';

// Wire format of the sync protocol (brief §8), shared by the web client and the API so
// both sides validate exactly the same thing.

export const MAX_PUSH_ROWS = 500;
export const MAX_PULL_LIMIT = 500;

export const PushRequestSchema = z
  .object({
    deviceId: z.string().min(1).max(100),
    decks: z.array(DeckSchema),
    cards: z.array(CardSchema),
    reviewLogs: z.array(ReviewLogSchema),
  })
  .refine((b) => b.decks.length + b.cards.length + b.reviewLogs.length <= MAX_PUSH_ROWS, {
    message: `A push may contain at most ${String(MAX_PUSH_ROWS)} rows in total`,
  });

export const PushResponseSchema = z.object({
  accepted: z.object({
    decks: z.array(Uuid),
    cards: z.array(Uuid),
    reviewLogs: z.array(Uuid),
  }),
});

export const PullQuerySchema = z.object({
  /** Opaque cursor: the last serverSeq seen, as a decimal string (it is a bigint). */
  since: z
    .string()
    .regex(/^\d{1,19}$/, 'since must be a non-negative integer')
    .default('0'),
  limit: z.coerce.number().int().min(1).max(MAX_PULL_LIMIT).default(MAX_PULL_LIMIT),
});

export const PullResponseSchema = z.object({
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
  nextCursor: z.string().regex(/^\d{1,19}$/),
  hasMore: z.boolean(),
});

export type PushRequest = z.infer<typeof PushRequestSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
export type PullQuery = z.infer<typeof PullQuerySchema>;
export type PullResponse = z.infer<typeof PullResponseSchema>;

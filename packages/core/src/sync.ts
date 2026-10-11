import { z } from 'zod';
import { EventSchema } from './events';
import { CardIdSchema, CardSchema, DeckSchema, ReviewLogSchema, Uuid } from './schemas';

// Wire format of the sync protocol (brief §8), shared by the web client and the API so
// both sides validate exactly the same thing.

export const MAX_PUSH_ROWS = 500;
/**
 * Sync protocol version. The server answers 426 to clients that don't send it.
 * - 2 (M6, §6.6): pushes from clients that predate typed cards would overwrite
 *   `type`/`content` through last-write-wins.
 * - 3 (M7): catalog decks, catalog card ids (v5) and new event types. An M6 app can't
 *   parse those rows, and would push catalog decks back without their catalog fields, so
 *   pulls carry the version too.
 */
export const PROTOCOL_VERSION = 3;
export const MAX_PULL_LIMIT = 500;

export const PushRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    deviceId: z.string().min(1).max(100),
    decks: z.array(DeckSchema),
    cards: z.array(CardSchema),
    reviewLogs: z.array(ReviewLogSchema),
    /** Product events (M4); optional so older clients still validate. */
    events: z.array(EventSchema).default([]),
  })
  .refine(
    (b) => b.decks.length + b.cards.length + b.reviewLogs.length + b.events.length <= MAX_PUSH_ROWS,
    {
      message: `A push may contain at most ${String(MAX_PUSH_ROWS)} rows in total`,
    },
  );

export const PushResponseSchema = z.object({
  accepted: z.object({
    decks: z.array(Uuid),
    cards: z.array(CardIdSchema),
    reviewLogs: z.array(Uuid),
    events: z.array(Uuid).default([]),
  }),
});

export const PullQuerySchema = z.object({
  /** Opaque cursor: the last serverSeq seen, as a decimal string (it is a bigint). */
  since: z
    .string()
    .regex(/^\d{1,19}$/, 'since must be a non-negative integer')
    .default('0'),
  limit: z.coerce.number().int().min(1).max(MAX_PULL_LIMIT).default(MAX_PULL_LIMIT),
  protocolVersion: z.coerce.number().pipe(z.literal(PROTOCOL_VERSION)),
  /** The event catalogue the app understands (EVENTS_VERSION); apps before it send none. */
  eventsVersion: z.coerce.number().int().min(1).default(1),
});

export const PullResponseSchema = z.object({
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  reviewLogs: z.array(ReviewLogSchema),
  events: z.array(EventSchema).default([]),
  nextCursor: z.string().regex(/^\d{1,19}$/),
  hasMore: z.boolean(),
});

export type PushRequest = z.infer<typeof PushRequestSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
export type PullQuery = z.infer<typeof PullQuerySchema>;
export type PullResponse = z.infer<typeof PullResponseSchema>;

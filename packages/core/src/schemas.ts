import { z } from 'zod';
import {
  allowedRatings,
  CARD_TYPES,
  CardContentSchema,
  deriveDisplay,
  OutcomeSchema,
  type CardContent,
} from './content';

// Synced entities. These schemas are the single definition of the wire format:
// the TypeScript types below are inferred from them, so the two can never drift.
//
// Unknown keys are stripped (zod's default), so local-only fields such as `dirty`
// and `localVersion` can never reach the server through a parsed row.

export const MAX_DECK_NAME_LENGTH = 200;
export const MAX_CARD_TEXT_LENGTH = 20_000;

export const Uuid = z.uuid({ version: 'v7' });
/**
 * A card id: a v7 UUID, or (M7, §7.5) the v5 UUID of a catalog card, derived from its
 * deck and key (`catalogCardId`).
 */
export const CardIdSchema = z.union([Uuid, z.uuid({ version: 'v5' })]);
/** Epoch milliseconds. `z.int()` also restricts to safe integers. */
const EpochMs = z.int().nonnegative();

/** A catalog deck's slug (M7, §7.2): lower-case a–z, 0–9 and single dashes. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower-case letters, digits and dashes');

export const DeckSchema = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(MAX_DECK_NAME_LENGTH),
    source: z.enum(['user', 'prebuilt', 'catalog']),
    prebuiltId: z.string().min(1).nullable(),
    /** M7 (§7.5): the catalog deck this copy came from, and the version it is on. */
    catalogSlug: SlugSchema.nullable().default(null),
    catalogVersion: z.int().min(1).nullable().default(null),
    createdAt: EpochMs,
    updatedAt: EpochMs,
    deletedAt: EpochMs.nullable(),
  })
  .refine((deck) => (deck.source === 'prebuilt') === (deck.prebuiltId !== null), {
    message: 'prebuiltId must be set exactly when source is "prebuilt"',
    path: ['prebuiltId'],
  })
  .refine(
    (deck) =>
      deck.source === 'catalog'
        ? deck.catalogSlug !== null && deck.catalogVersion !== null
        : deck.catalogSlug === null && deck.catalogVersion === null,
    {
      message: 'catalogSlug and catalogVersion must be set exactly when source is "catalog"',
      path: ['catalogSlug'],
    },
  );

/**
 * A card (M6, BUILD_BRIEF_M6_M8 §6.2). `content` is the source of truth; `front` and
 * `back` are the plain display text derived from it (for lists, search and pre-M6
 * clients) and must equal `deriveDisplay(content)`.
 */
export const CardSchema = z
  .object({
    id: CardIdSchema,
    deckId: Uuid,
    type: z.enum(CARD_TYPES),
    content: CardContentSchema,
    front: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
    back: z.string().min(1).max(MAX_CARD_TEXT_LENGTH),
    /** Syllabus unit (M7 unit filter). */
    unit: z.int().min(1).max(99).nullable().default(null),
    /** M7: the catalog card this was copied from, and the hash of its content then. */
    sourceKey: z.string().min(1).max(100).nullable().default(null),
    sourceHash: z.string().min(1).max(128).nullable().default(null),
    createdAt: EpochMs,
    updatedAt: EpochMs,
    deletedAt: EpochMs.nullable(),
  })
  .superRefine((card, ctx) => {
    if (card.type !== card.content.type) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'type must match content.type' });
      return;
    }
    const display = deriveDisplay(card.content);
    if (card.front !== display.front || card.back !== display.back) {
      ctx.addIssue({
        code: 'custom',
        path: ['front'],
        message: 'front/back must be derived from content (deriveDisplay)',
      });
    }
  });

/** The content-dependent fields of a card: type, content and the derived display text. */
export function cardFields(content: CardContent): {
  type: CardContent['type'];
  content: CardContent;
  front: string;
  back: string;
} {
  return { type: content.type, content, ...deriveDisplay(content) };
}

export const RatingSchema = z.literal([1, 2, 3, 4]);

export const ReviewLogSchema = z
  .object({
    id: Uuid,
    cardId: CardIdSchema,
    rating: RatingSchema,
    reviewedAt: EpochMs,
    durationMs: z.int().nonnegative(),
    deviceId: z.string().min(1).max(100),
    voidedAt: EpochMs.nullable(),
    /** M6 (§6.4): what happened in the review. Never typed text. Replay ignores it. */
    outcome: OutcomeSchema.nullable().default(null),
  })
  .refine((log) => allowedRatings(log.outcome).includes(log.rating), {
    message: 'this rating is not allowed for this outcome',
    path: ['rating'],
  });

export type Deck = z.infer<typeof DeckSchema>;
export type Card = z.infer<typeof CardSchema>;
export type ReviewLog = z.infer<typeof ReviewLogSchema>;
export type Rating = z.infer<typeof RatingSchema>;

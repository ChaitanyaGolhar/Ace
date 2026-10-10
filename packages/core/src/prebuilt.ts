import { z } from 'zod';
import { MAX_CARD_TEXT_LENGTH, MAX_DECK_NAME_LENGTH } from './schemas';

/**
 * A ready-made deck file, `content/decks/<prebuiltId>.json` (brief §11). Validated at
 * build time, so strict: unknown keys (likely typos) and duplicate questions are errors.
 */
export const PrebuiltDeckSchema = z
  .strictObject({
    prebuiltId: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lower-case slug like "dbms-basics-v1"'),
    name: z.string().min(1).max(MAX_DECK_NAME_LENGTH),
    description: z.string().min(1).max(500),
    version: z.int().min(1),
    cards: z
      .array(
        z.strictObject({
          front: z.string().trim().min(1).max(MAX_CARD_TEXT_LENGTH),
          back: z.string().trim().min(1).max(MAX_CARD_TEXT_LENGTH),
        }),
      )
      .min(1, 'a deck needs at least one card'),
  })
  .superRefine((deck, ctx) => {
    const seen = new Map<string, number>();
    deck.cards.forEach((card, i) => {
      const key = card.front.trim().toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['cards', i, 'front'],
          message: `duplicate question (same as card ${String(first + 1)})`,
        });
      } else {
        seen.set(key, i);
      }
    });
  });

export type PrebuiltDeck = z.infer<typeof PrebuiltDeckSchema>;

import { z } from 'zod';
import { CARD_TYPES, CardContentSchema, type CardType } from './content';
import { cardContentOf, YEARS, type DeckFile, type DeckFileCard } from './deckFile';
import { SlugSchema } from './schemas';

// The store's view of catalog decks (BUILD_BRIEF_M6_M8 §7.3): what `GET /catalog` lists
// (metadata and counts, no card content) and what `GET /catalog/:slug` adds (sample
// cards). Shared by the API, which builds them, and the app, which parses them.

export const SAMPLE_CARD_COUNT = 8;

/** A file card as it travels in API responses: key, unit and its M6 content. */
export const DeckFileCardSchema = z.custom<DeckFileCard>((v) => {
  if (typeof v !== 'object' || v === null) return false;
  const { key, unit, ...content } = v as Record<string, unknown>;
  return (
    typeof key === 'string' &&
    typeof unit === 'number' &&
    Number.isInteger(unit) &&
    CardContentSchema.safeParse(content).success
  );
}, 'not a valid card');

const TypeCounts = z.object(
  Object.fromEntries(CARD_TYPES.map((t) => [t, z.int().nonnegative()])) as Record<
    CardType,
    z.ZodInt
  >,
);

export const CatalogDeckSummarySchema = z.object({
  slug: SlugSchema,
  version: z.int().min(1),
  title: z.string(),
  description: z.string(),
  catalog: z.object({
    university: z.string(),
    pattern: z.string(),
    year: z.enum(YEARS),
    semester: z.int(),
    branches: z.array(z.string()),
    subject: z.string(),
    subjectCodes: z.record(z.string(), z.string().nullable()),
  }),
  units: z.array(z.object({ number: z.int(), title: z.string(), cardCount: z.int() })),
  /** Paise; 0 = free. */
  price: z.int().nonnegative(),
  author: z.string(),
  reviewedBy: z.string().nullable(),
  lastVerifiedAt: z.string(),
  cardCount: z.int().nonnegative(),
  typeCounts: TypeCounts,
});

export const CatalogListSchema = z.object({ decks: z.array(CatalogDeckSummarySchema) });
export const CatalogDetailSchema = z.object({
  deck: CatalogDeckSummarySchema,
  samples: z.array(DeckFileCardSchema),
});

export type CatalogDeckSummary = z.infer<typeof CatalogDeckSummarySchema>;
export type CatalogList = z.infer<typeof CatalogListSchema>;
export type CatalogDetail = z.infer<typeof CatalogDetailSchema>;

/** The store listing of one deck version: metadata and counts, no card content. */
export function summarizeDeck(deck: DeckFile): CatalogDeckSummary {
  const typeCounts = Object.fromEntries(CARD_TYPES.map((t) => [t, 0])) as Record<CardType, number>;
  for (const card of deck.cards) typeCounts[card.type] += 1;
  const { units, ...catalog } = deck.catalog;
  return {
    slug: deck.slug,
    version: deck.version,
    title: deck.title,
    description: deck.description,
    catalog,
    units: units.map((u) => ({
      number: u.number,
      title: u.title,
      cardCount: deck.cards.filter((c) => c.unit === u.number).length,
    })),
    price: deck.price,
    author: deck.author,
    reviewedBy: deck.reviewedBy,
    lastVerifiedAt: deck.lastVerifiedAt,
    cardCount: deck.cards.length,
    typeCounts,
  };
}

/** Orders keys like "u2-001" by unit then number, so u2 comes before u10. */
export function compareKeys(a: string, b: string): number {
  const parse = (k: string) => (/^u(\d+)-(\d+)$/.exec(k) ?? []).slice(1).map(Number);
  const [ua = 0, na = 0] = parse(a);
  const [ub = 0, nb = 0] = parse(b);
  return ua - ub || na - nb || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The sample cards on a deck's store page (§7.3): the first card of each type (in file
 * order), then more in key order up to 8. Returned in key order. Deterministic.
 */
export function sampleCards(deck: DeckFile, count = SAMPLE_CARD_COUNT): DeckFileCard[] {
  const chosen = new Set<string>();
  for (const type of CARD_TYPES) {
    const first = deck.cards.find((c) => c.type === type);
    if (first && chosen.size < count) chosen.add(first.key);
  }
  for (const card of [...deck.cards].sort((a, b) => compareKeys(a.key, b.key))) {
    if (chosen.size >= count) break;
    chosen.add(card.key);
  }
  return deck.cards
    .filter((c) => chosen.has(c.key))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map((c) => ({ key: c.key, unit: c.unit, ...cardContentOf(c) }));
}

import {
  canonicalJson,
  sha1Hex,
  summarizeDeck,
  validateDeckFile,
  type DeckFile,
} from '@recall/core';
import type { Prisma } from '../db';

// The catalog in Postgres (BUILD_BRIEF_M6_M8 §7.3): `catalog_deck` (latest version,
// status) and `catalog_deck_version` (the full validated file of each version, immutable
// by trigger). Written only by the owner's CLI, never through the API.

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

export type CatalogStatus = 'published' | 'unlisted';

interface DeckRow {
  slug: string;
  latest_version: number;
  status: CatalogStatus;
}

/** Re-validates a stored file (it was valid when published; this also gives it its type). */
function fileOf(content: unknown): DeckFile {
  const result = validateDeckFile(content);
  if (!result.ok) throw new Error(`stored catalog file is invalid: ${result.errors.join('; ')}`);
  return result.deck;
}

export async function latestVersionOf(prisma: Prisma, slug: string): Promise<number | null> {
  const row = await prisma.catalogDeck.findUnique({ where: { slug } });
  return row?.latestVersion ?? null;
}

/**
 * Publishes `deck` as the next version of its slug, in one transaction. The version must
 * be exactly the latest + 1 (1 for a new deck); the deck row is locked so two publishes
 * can't race.
 */
export async function publishVersion(
  prisma: Prisma,
  deck: DeckFile,
  options: { unlisted?: boolean } = {},
): Promise<void> {
  const status: CatalogStatus = options.unlisted ? 'unlisted' : 'published';
  const summary = summarizeDeck(deck);
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<DeckRow[]>`
      SELECT slug, latest_version, status FROM catalog_deck WHERE slug = ${deck.slug} FOR UPDATE`;
    const expected = row ? row.latest_version + 1 : 1;
    if (deck.version !== expected) {
      throw new PublishError(
        row
          ? `version must be ${String(expected)} (the latest is ${String(row.latest_version)}), got ${String(deck.version)}`
          : `version must be 1 (a new deck), got ${String(deck.version)}`,
      );
    }
    if (row) {
      await tx.$executeRaw`
        UPDATE catalog_deck SET latest_version = ${deck.version}, status = ${status},
          updated_at = CURRENT_TIMESTAMP
        WHERE slug = ${deck.slug}`;
    } else {
      await tx.$executeRaw`
        INSERT INTO catalog_deck (slug, latest_version, status)
        VALUES (${deck.slug}, ${deck.version}, ${status})`;
    }
    await tx.$executeRaw`
      INSERT INTO catalog_deck_version (slug, version, content, checksum, card_count, type_counts)
      VALUES (${deck.slug}, ${deck.version}, ${JSON.stringify(deck)}::jsonb,
              ${sha1Hex(canonicalJson(deck))}, ${summary.cardCount},
              ${JSON.stringify(summary.typeCounts)}::jsonb)`;
  });
}

/** Hides a deck from the store. Its versions stay fetchable. False if there is no such deck. */
export async function unlistDeck(prisma: Prisma, slug: string): Promise<boolean> {
  const changed = await prisma.$executeRaw`
    UPDATE catalog_deck SET status = 'unlisted', updated_at = CURRENT_TIMESTAMP WHERE slug = ${slug}`;
  return changed > 0;
}

/** One version's file, whatever the deck's status. */
export async function getVersion(
  prisma: Prisma,
  slug: string,
  version: number,
): Promise<DeckFile | null> {
  const row = await prisma.catalogDeckVersion.findUnique({
    where: { slug_version: { slug, version } },
  });
  return row ? fileOf(row.content) : null;
}

/** The latest version of every published (listed) deck. */
export async function listPublished(prisma: Prisma): Promise<DeckFile[]> {
  const rows = await prisma.$queryRaw<{ content: unknown }[]>`
    SELECT v.content FROM catalog_deck d
    JOIN catalog_deck_version v ON v.slug = d.slug AND v.version = d.latest_version
    WHERE d.status = 'published'`;
  return rows.map((r) => fileOf(r.content));
}

/** The latest version of one published deck, or null (unknown or unlisted). */
export async function getPublished(prisma: Prisma, slug: string): Promise<DeckFile | null> {
  const [row] = await prisma.$queryRaw<{ content: unknown }[]>`
    SELECT v.content FROM catalog_deck d
    JOIN catalog_deck_version v ON v.slug = d.slug AND v.version = d.latest_version
    WHERE d.slug = ${slug} AND d.status = 'published'`;
  return row ? fileOf(row.content) : null;
}

export interface CatalogDeckListing {
  slug: string;
  version: number;
  status: CatalogStatus;
  price: number;
  cardCount: number;
}

/** Every deck with its latest version, listed or not (for the owner's `pnpm deck list`). */
export async function listAll(prisma: Prisma): Promise<CatalogDeckListing[]> {
  const rows = await prisma.$queryRaw<
    {
      slug: string;
      latest_version: number;
      status: CatalogStatus;
      card_count: number;
      price: number;
    }[]
  >`
    SELECT d.slug, d.latest_version, d.status, v.card_count, (v.content->>'price')::int AS price
    FROM catalog_deck d
    JOIN catalog_deck_version v ON v.slug = d.slug AND v.version = d.latest_version
    ORDER BY d.slug`;
  return rows.map((r) => ({
    slug: r.slug,
    version: r.latest_version,
    status: r.status,
    price: r.price,
    cardCount: r.card_count,
  }));
}

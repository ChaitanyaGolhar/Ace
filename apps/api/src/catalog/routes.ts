import {
  sampleCards,
  sha1Hex,
  SlugSchema,
  summarizeDeck,
  YEARS,
  type CatalogDetail,
  type CatalogList,
  type DeckFile,
} from '@recall/core';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { HttpError } from '../errors';
import { getPublished, getVersion, listPublished } from './store';

// Public, read-only catalog endpoints (BUILD_BRIEF_M6_M8 §7.3). There are no write
// endpoints: publishing happens only through the owner's CLI.

const ListQuerySchema = z.object({
  year: z.enum(YEARS).optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
  branch: z.string().min(1).max(30).optional(),
  subject: z.string().max(100).optional(),
});

const VersionParamsSchema = z.object({
  slug: SlugSchema,
  version: z.coerce.number().int().min(1).max(100_000),
});

/**
 * The list and the detail change only on publish. `no-cache` = the browser keeps its copy
 * but revalidates every time (a 304 when nothing changed), so a new version shows at once.
 */
const LISTING_CACHE = 'public, no-cache';
/** A published version never changes. */
const VERSION_CACHE = 'public, max-age=31536000, immutable';

/** Sends JSON with a strong ETag of the body; answers 304 to a matching If-None-Match. */
function sendWithEtag(req: Request, res: Response, body: unknown, cacheControl: string): void {
  const json = JSON.stringify(body);
  const etag = `"${sha1Hex(json)}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', cacheControl);
  if (req.get('If-None-Match') === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json').send(json);
}

const yearRank = (deck: DeckFile) => YEARS.indexOf(deck.catalog.year);

export function catalogRoutes({ prisma }: AppDeps): Router {
  const router = Router();

  router.get('/catalog', async (req, res) => {
    const q = ListQuerySchema.parse(req.query);
    const subject = q.subject?.trim().toLowerCase();
    const decks = (await listPublished(prisma))
      .filter(
        (d) =>
          (q.year === undefined || d.catalog.year === q.year) &&
          (q.semester === undefined || d.catalog.semester === q.semester) &&
          (q.branch === undefined || d.catalog.branches.includes(q.branch)) &&
          (subject === undefined ||
            subject === '' ||
            d.catalog.subject.toLowerCase().includes(subject)),
      )
      .sort(
        (a, b) =>
          yearRank(a) - yearRank(b) ||
          a.catalog.semester - b.catalog.semester ||
          a.catalog.subject.localeCompare(b.catalog.subject) ||
          a.slug.localeCompare(b.slug),
      );
    const body: CatalogList = { decks: decks.map(summarizeDeck) };
    sendWithEtag(req, res, body, LISTING_CACHE);
  });

  router.get('/catalog/:slug', async (req, res) => {
    const slug = SlugSchema.safeParse(req.params.slug);
    const deck = slug.success ? await getPublished(prisma, slug.data) : null;
    if (!deck) throw new HttpError(404, 'not_found', 'This deck isn’t in the store.');
    const body: CatalogDetail = { deck: summarizeDeck(deck), samples: sampleCards(deck) };
    sendWithEtag(req, res, body, LISTING_CACHE);
  });

  router.get('/catalog/:slug/versions/:version', async (req, res) => {
    const { slug, version } = VersionParamsSchema.parse(req.params);
    const deck = await getVersion(prisma, slug, version);
    if (!deck) throw new HttpError(404, 'not_found', 'This version doesn’t exist.');
    if (deck.price > 0) {
      // M8 replaces this with the entitlement check (§8.2).
      throw new HttpError(403, 'forbidden', 'This deck is paid. Unlock it to download it.');
    }
    sendWithEtag(req, res, deck, VERSION_CACHE);
  });

  return router;
}

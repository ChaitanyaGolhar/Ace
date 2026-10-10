import {
  CatalogDetailSchema,
  CatalogListSchema,
  sampleCards,
  validateDeckFile,
  type CardContent,
} from '@recall/core';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishVersion, unlistDeck } from '../src/catalog/store';
import { closeTestPrisma, makeTestApp, resetDb, testPrisma } from './helpers';
import { basic, deckFile, type FileCard } from './catalogFixtures';

// The public catalog endpoints (BUILD_BRIEF_M6_M8 §7.3): read-only, no auth for free
// decks, ETag + Cache-Control, filters, and the deterministic sample cards.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

const prisma = testPrisma();

async function seedCatalog() {
  await publishVersion(prisma, deckFile());
  await publishVersion(
    prisma,
    deckFile({ version: 2 }, [
      ['u1-001', 1, basic('What is a DBMS?')],
      ['u1-002', 1, basic('What is a candidate key?')],
      ['u2-001', 2, basic('What is a view?')],
      ['u2-002', 2, basic('What is a join?')],
    ]),
  );
  await publishVersion(
    prisma,
    deckFile({
      slug: 'sppu-te-aids-ml',
      title: 'Machine Learning',
      catalog: {
        year: 'TE',
        semester: 6,
        branches: ['AIDS'],
        subject: 'Machine Learning',
        subjectCodes: { AIDS: 'PCC302AID' },
      },
    }),
  );
  await publishVersion(
    prisma,
    deckFile({
      slug: 'sppu-se-cse-dsa',
      title: 'Data Structures',
      catalog: {
        year: 'SE',
        semester: 3,
        branches: ['CSE'],
        subject: 'Data Structures',
        subjectCodes: { CSE: null },
      },
    }),
  );
}

describe('GET /catalog', () => {
  it('lists the latest published version of each deck, with counts and no card content', async () => {
    await seedCatalog();
    const t = makeTestApp();
    const res = await request(t.app).get('/catalog').expect(200);
    const list = CatalogListSchema.parse(res.body);
    expect(list.decks.map((d) => [d.slug, d.version])).toEqual([
      ['sppu-se-cse-dsa', 1],
      ['sppu-te-cse-dbms', 2],
      ['sppu-te-aids-ml', 1],
    ]);
    const dbms = list.decks.find((d) => d.slug === 'sppu-te-cse-dbms');
    expect(dbms).toMatchObject({
      cardCount: 4,
      typeCounts: { basic: 4, mcq: 0 },
      price: 0,
      lastVerifiedAt: '2026-10-11',
      units: [
        { number: 1, cardCount: 2 },
        { number: 2, cardCount: 2 },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('What is a');
  });

  it('filters by year, semester, branch and subject (case-insensitive part of the name)', async () => {
    await seedCatalog();
    const t = makeTestApp();
    const slugs = async (query: Record<string, string>) =>
      CatalogListSchema.parse(
        (await request(t.app).get('/catalog').query(query).expect(200)).body,
      ).decks.map((d) => d.slug);
    expect(await slugs({ year: 'TE' })).toEqual(['sppu-te-cse-dbms', 'sppu-te-aids-ml']);
    expect(await slugs({ semester: '6' })).toEqual(['sppu-te-aids-ml']);
    expect(await slugs({ branch: 'CSE' })).toEqual(['sppu-se-cse-dsa', 'sppu-te-cse-dbms']);
    expect(await slugs({ branch: 'CSE-DS' })).toEqual(['sppu-te-cse-dbms']);
    expect(await slugs({ subject: 'machine' })).toEqual(['sppu-te-aids-ml']);
    expect(await slugs({ year: 'TE', branch: 'AIDS' })).toEqual(['sppu-te-aids-ml']);
    expect(await slugs({ year: 'BE' })).toEqual([]);
    await request(t.app).get('/catalog').query({ semester: 'nine' }).expect(400);
    await request(t.app).get('/catalog').query({ year: 'XX' }).expect(400);
  });

  it('sends an ETag and Cache-Control; a matching If-None-Match gets 304', async () => {
    await seedCatalog();
    const t = makeTestApp();
    const first = await request(t.app).get('/catalog').expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    expect(first.headers['cache-control']).toBe('public, no-cache');
    const second = await request(t.app).get('/catalog').set('If-None-Match', etag).expect(304);
    expect(second.text).toBe('');
    // A new version changes the ETag.
    await publishVersion(prisma, deckFile({ version: 3 }));
    const third = await request(t.app).get('/catalog').set('If-None-Match', etag).expect(200);
    expect(third.headers.etag).not.toBe(etag);
    // Filters have their own ETags.
    const filtered = await request(t.app).get('/catalog').query({ year: 'SE' }).expect(200);
    expect(filtered.headers.etag).not.toBe(third.headers.etag);
  });

  it('an unlisted deck disappears from the list', async () => {
    await seedCatalog();
    await unlistDeck(prisma, 'sppu-te-aids-ml');
    const t = makeTestApp();
    const list = CatalogListSchema.parse((await request(t.app).get('/catalog').expect(200)).body);
    expect(list.decks.map((d) => d.slug)).not.toContain('sppu-te-aids-ml');
  });

  it('needs no session and allows the web app origin (CORS)', async () => {
    await seedCatalog();
    const t = makeTestApp();
    const res = await request(t.app)
      .get('/catalog')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('GET /catalog/:slug', () => {
  it('metadata, the version, and 8 sample cards (first of each type, then key order)', async () => {
    const cards: FileCard[] = [
      ['u1-001', 1, basic('one')],
      ['u1-002', 1, basic('two')],
      ['u1-003', 1, basic('three')],
      ['u1-004', 1, basic('four')],
      ['u1-005', 1, basic('five')],
      ['u1-006', 1, basic('six')],
      ['u1-007', 1, basic('seven')],
      ['u2-001', 2, { type: 'short', question: 'Why?', answer: 'Because.', explanation: null }],
      [
        'u2-002',
        2,
        {
          type: 'long',
          question: 'Explain.',
          marks: 6,
          keyPoints: ['a', 'b', 'c'],
          modelAnswer: null,
        } satisfies CardContent,
      ],
    ];
    const file = deckFile({}, cards);
    await publishVersion(prisma, file);
    const t = makeTestApp();
    const res = await request(t.app).get('/catalog/sppu-te-cse-dbms').expect(200);
    const detail = CatalogDetailSchema.parse(res.body);
    expect(detail.deck).toMatchObject({ slug: 'sppu-te-cse-dbms', version: 1, cardCount: 9 });
    expect(detail.samples.map((c) => c.key)).toEqual(sampleCards(file).map((c) => c.key));
    expect(detail.samples.map((c) => c.key)).toEqual([
      'u1-001',
      'u1-002',
      'u1-003',
      'u1-004',
      'u1-005',
      'u1-006',
      'u2-001',
      'u2-002',
    ]);
  });

  it('404 for an unknown or unlisted deck', async () => {
    await seedCatalog();
    await unlistDeck(prisma, 'sppu-te-aids-ml');
    const t = makeTestApp();
    await request(t.app).get('/catalog/nope').expect(404);
    await request(t.app).get('/catalog/sppu-te-aids-ml').expect(404);
  });
});

describe('GET /catalog/:slug/versions/:version', () => {
  it('the full validated file of that exact version, for free decks without a session', async () => {
    await seedCatalog();
    const t = makeTestApp();
    const v1 = await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/1').expect(200);
    const parsed = validateDeckFile(v1.body);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.deck).toEqual(deckFile());
    expect(v1.headers['cache-control']).toMatch(/immutable/);
    const v2 = await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/2').expect(200);
    expect((v2.body as { version: number }).version).toBe(2);
  });

  it('404 for an unknown version; 400 for a malformed one', async () => {
    await seedCatalog();
    const t = makeTestApp();
    await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/9').expect(404);
    await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/x').expect(400);
  });

  it('stays fetchable after the deck is unlisted (students who added it keep updating)', async () => {
    await seedCatalog();
    await unlistDeck(prisma, 'sppu-te-cse-dbms');
    const t = makeTestApp();
    await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/2').expect(200);
  });

  it('a paid deck’s content is not public (403)', async () => {
    await publishVersion(prisma, deckFile({ slug: 'paid-deck', price: 4900 }));
    const t = makeTestApp();
    const res = await request(t.app).get('/catalog/paid-deck/versions/1').expect(403);
    expect(res.body).toMatchObject({ error: { code: 'forbidden' } });
    // Its listing and samples are public, as for any deck.
    await request(t.app).get('/catalog/paid-deck').expect(200);
  });
});

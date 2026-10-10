import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPrisma, DAY, HOUR, resetDb, testPrisma } from './helpers';

// M7 store analytics (BUILD_BRIEF_M6_M8 §7.8): per catalog deck, views → adds → users
// with ≥1 review → users still reviewing after 7 days. Answers worked out by hand.

const sql = readFileSync(new URL('../analytics.sql', import.meta.url), 'utf8');
const query = (name: string) => {
  const parts = sql.split(/^-- name: (\w+)\s*$/m);
  const i = parts.indexOf(name);
  if (i === -1) throw new Error(`no query named ${name}`);
  return (parts[i + 1] ?? '').trim().replace(/;\s*$/, '');
};

const prisma = testPrisma();
const T = Date.UTC(2026, 9, 1, 9);
let n = 0;
const id = () => `01920000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

async function exec(text: string, ...params: unknown[]) {
  await prisma.$executeRawUnsafe(text, ...params);
}
const event = (user: string, type: string, at: number, slug: string) =>
  exec(
    `INSERT INTO events (id, user_id, type, occurred_at, device_id, props, server_seq)
     VALUES ($1, $2, $3, $4, 'dev', $5::jsonb, nextval('change_seq'))`,
    id(),
    user,
    type,
    at,
    JSON.stringify(type === 'catalog_deck_added' ? { slug, version: 1 } : { slug }),
  );
async function copy(user: string, slug: string, at: number): Promise<string> {
  const deckId = id();
  await exec(
    `INSERT INTO decks (id, user_id, name, source, prebuilt_id, catalog_slug, catalog_version,
                        created_at, updated_at, deleted_at, server_seq)
     VALUES ($1, $2, 'D', 'catalog', NULL, $3, 1, $4, $4, NULL, nextval('change_seq'))`,
    deckId,
    user,
    slug,
    at,
  );
  const cardId = id();
  await exec(
    `INSERT INTO cards (id, user_id, deck_id, front, back, type, content, created_at, updated_at, deleted_at, server_seq)
     VALUES ($1, $2, $3, 'Q', 'A', 'basic', '{"type":"basic","front":"Q","back":"A"}', $4, $4, NULL, nextval('change_seq'))`,
    cardId,
    user,
    deckId,
    at,
  );
  return cardId;
}
const review = (user: string, cardId: string, at: number, voided = false) =>
  exec(
    `INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, voided_at, server_seq)
     VALUES ($1, $2, $3, 3, $4, 1000, 'dev', $5, nextval('change_seq'))`,
    id(),
    user,
    cardId,
    at,
    voided ? at + 1000 : null,
  );

beforeAll(async () => {
  await resetDb();
  for (const u of ['u1', 'u2', 'u3', 'u4']) {
    await exec('INSERT INTO users (id, email) VALUES ($1, $2)', u, `${u}@example.com`);
  }
  // u1: views, adds, reviews on day 0 and day 8 → reviewer, still reviewing after 7 days.
  await event('u1', 'catalog_deck_viewed', T, 'dbms');
  await event('u1', 'catalog_deck_added', T + HOUR, 'dbms');
  const c1 = await copy('u1', 'dbms', T + HOUR);
  await review('u1', c1, T + 2 * HOUR);
  await review('u1', c1, T + HOUR + 8 * DAY);
  // u2: views, adds, reviews on day 1 only; a later review was undone (doesn't count).
  await event('u2', 'catalog_deck_viewed', T, 'dbms');
  await event('u2', 'catalog_deck_added', T, 'dbms');
  const c2 = await copy('u2', 'dbms', T);
  await review('u2', c2, T + DAY);
  await review('u2', c2, T + 9 * DAY, true);
  // u3: views twice, never adds.
  await event('u3', 'catalog_deck_viewed', T, 'dbms');
  await event('u3', 'catalog_deck_viewed', T + DAY, 'dbms');
  // u4: views and adds "ml", never reviews; views "dbms" too.
  await event('u4', 'catalog_deck_viewed', T, 'ml');
  await event('u4', 'catalog_deck_added', T, 'ml');
  await copy('u4', 'ml', T);
  await event('u4', 'catalog_deck_viewed', T, 'dbms');
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('catalog_deck_funnel', () => {
  it('per deck: viewers → adders → reviewers → still reviewing after 7 days (distinct users)', async () => {
    const rows = await prisma.$queryRawUnsafe(query('catalog_deck_funnel'));
    expect(rows).toEqual([
      { slug: 'dbms', viewers: 4, adders: 2, reviewers: 2, retained_7d: 1 },
      { slug: 'ml', viewers: 1, adders: 1, reviewers: 0, retained_7d: 0 },
    ]);
  });
});

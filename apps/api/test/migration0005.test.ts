import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './testDb';

// The M8 migration (0005) on a database at the M7 schema with data: three new tables,
// nothing existing touched, and the constraints that keep redemption counts honest.

const migration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const DB = 'recall_migration5_test';
const admin = new URL(TEST_DATABASE_URL);
admin.pathname = '/postgres';
const target = new URL(TEST_DATABASE_URL);
target.pathname = `/${DB}`;
let db: pg.Client;

const snapshot = async () => {
  const out: Record<string, unknown[]> = {};
  for (const t of [
    'users',
    'decks',
    'cards',
    'review_logs',
    'catalog_deck',
    'catalog_deck_version',
  ]) {
    out[t] = (await db.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
  }
  return out;
};
let before: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  const a = new pg.Client({ connectionString: admin.toString() });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB}`);
  await a.query(`CREATE DATABASE ${DB}`);
  await a.end();
  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  for (const m of ['0001_init', '0002_events', '0003_question_types', '0004_deck_store']) {
    await db.query(migration(m));
  }
  await db.query(`
    INSERT INTO users (id, email) VALUES ('u1', 'a@example.com');
    INSERT INTO decks (id, user_id, name, source, prebuilt_id, catalog_slug, catalog_version, created_at, updated_at, deleted_at, server_seq)
      VALUES ('01920000-0000-7000-8000-000000000001', 'u1', 'ML', 'catalog', NULL, 'ml', 1, 1, 1, NULL, nextval('change_seq'));
    INSERT INTO catalog_deck (slug, latest_version) VALUES ('ml', 1);
    INSERT INTO catalog_deck_version (slug, version, content, checksum, card_count, type_counts)
      VALUES ('ml', 1, '{"price": 4900}', 'x', 0, '{}');
  `);
  before = await snapshot();
  await db.query(migration('0005_paid_decks'));
});

afterAll(async () => {
  await db.end();
});

describe('migration 0005_paid_decks', () => {
  it('leaves every existing table’s rows as they were', async () => {
    expect(await snapshot()).toEqual(before);
  });

  it('a code’s redemption count can’t exceed its maximum, or go below 0; it needs a deck', async () => {
    await db.query(`INSERT INTO unlock_code (id, code_hash, slugs) VALUES ('C1', 'h1', '{ml}')`);
    await db.query(`UPDATE unlock_code SET redemption_count = 1 WHERE id = 'C1'`);
    await expect(
      db.query(`UPDATE unlock_code SET redemption_count = 2 WHERE id = 'C1'`),
    ).rejects.toThrow(/unlock_code_count_check/);
    await expect(
      db.query(`INSERT INTO unlock_code (id, code_hash, slugs) VALUES ('C2', 'h2', '{}')`),
    ).rejects.toThrow(/unlock_code_slugs_check/);
    await expect(
      db.query(`INSERT INTO unlock_code (id, code_hash, slugs) VALUES ('C3', 'h1', '{ml}')`),
    ).rejects.toThrow(/unlock_code_code_hash_key/);
  });

  it('one redemption per (code, user); one entitlement per (user, deck)', async () => {
    await db.query(`INSERT INTO unlock_redemption (code_id, user_id) VALUES ('C1', 'u1')`);
    await expect(
      db.query(`INSERT INTO unlock_redemption (code_id, user_id) VALUES ('C1', 'u1')`),
    ).rejects.toThrow(/unlock_redemption_pkey/);
    await db.query(`INSERT INTO entitlement (user_id, slug, code_id) VALUES ('u1', 'ml', 'C1')`);
    await expect(
      db.query(`INSERT INTO entitlement (user_id, slug) VALUES ('u1', 'ml')`),
    ).rejects.toThrow(/entitlement_pkey/);
  });

  it('is additive: the M7 API’s writes still work', async () => {
    await db.query(`
      INSERT INTO decks (id, user_id, name, source, prebuilt_id, catalog_slug, catalog_version, created_at, updated_at, deleted_at, server_seq)
      VALUES ('01920000-0000-7000-8000-000000000002', 'u1', 'Mine', 'user', NULL, NULL, NULL, 2, 2, NULL, nextval('change_seq'))`);
    expect((await db.query(`SELECT count(*)::int AS n FROM decks`)).rows[0]).toEqual({ n: 2 });
  });
});

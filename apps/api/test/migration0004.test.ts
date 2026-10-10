import { readFileSync } from 'node:fs';
import { DeckSchema } from '@recall/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toDeck, type DeckRow } from '../src/sync/rows';
import { TEST_DATABASE_URL } from './testDb';

// The M7 migration (0004) against a database at the M6 schema with realistic data:
// additive columns and tables only; existing rows untouched; the previous API keeps
// working; published versions are immutable.

const migration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const DB = 'recall_migration4_test';
const admin = new URL(TEST_DATABASE_URL);
admin.pathname = '/postgres';
const target = new URL(TEST_DATABASE_URL);
target.pathname = `/${DB}`;

let db: pg.Client;

type Raw = Record<string, unknown>;
const big = (v: unknown) => BigInt(String(v));
const asDeckRow = (r: Raw): DeckRow => ({
  ...(r as unknown as DeckRow),
  created_at: big(r.created_at),
  updated_at: big(r.updated_at),
  deleted_at: r.deleted_at === null ? null : big(r.deleted_at),
  server_seq: big(r.server_seq),
});

const snapshot = async () => ({
  decks: (await db.query('SELECT * FROM decks ORDER BY id')).rows,
  cards: (await db.query('SELECT * FROM cards ORDER BY id')).rows,
  logs: (await db.query('SELECT * FROM review_logs ORDER BY id')).rows,
});
let before: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  const a = new pg.Client({ connectionString: admin.toString() });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB}`);
  await a.query(`CREATE DATABASE ${DB}`);
  await a.end();

  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  for (const m of ['0001_init', '0002_events', '0003_question_types']) await db.query(migration(m));
  await db.query(`
    INSERT INTO users (id, email) VALUES ('u1', 'a@example.com');
    INSERT INTO decks (id, user_id, name, source, prebuilt_id, created_at, updated_at, deleted_at, server_seq) VALUES
      ('01920000-0000-7000-8000-000000000001', 'u1', 'DBMS', 'prebuilt', 'dbms-basics-v1', 1, 1, NULL, nextval('change_seq')),
      ('01920000-0000-7000-8000-000000000002', 'u1', 'Mine', 'user', NULL, 1, 2, 2, nextval('change_seq'));
    INSERT INTO cards (id, user_id, deck_id, front, back, type, content, created_at, updated_at, deleted_at, server_seq) VALUES
      ('01920000-0000-7000-8000-000000000101', 'u1', '01920000-0000-7000-8000-000000000001', 'Q', 'A', 'basic',
       '{"type":"basic","front":"Q","back":"A"}', 10, 20, NULL, nextval('change_seq'));
    INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, voided_at, server_seq) VALUES
      ('01920000-0000-7000-8000-000000001001', 'u1', '01920000-0000-7000-8000-000000000101', 3, 100, 5000, 'dev', NULL, nextval('change_seq'));
  `);
  before = await snapshot();
  await db.query(migration('0004_deck_store'));
});

afterAll(async () => {
  await db.end();
});

describe('migration 0004_deck_store', () => {
  it('leaves every existing deck, card and log as it was; decks get NULL catalog fields', async () => {
    const after = await snapshot();
    expect(after.cards).toEqual(before.cards);
    expect(after.logs).toEqual(before.logs);
    expect(after.decks).toEqual(
      before.decks.map((d: Raw) => ({ ...d, catalog_slug: null, catalog_version: null })),
    );
  });

  it('every existing deck reads as a valid M7 deck', async () => {
    const rows = (await db.query('SELECT * FROM decks')).rows as Raw[];
    for (const r of rows) {
      expect(DeckSchema.safeParse(toDeck(asDeckRow(r))).success).toBe(true);
    }
  });

  it('is additive: the M6 API’s deck insert (no catalog columns) still works', async () => {
    await db.query(`
      INSERT INTO decks (id, user_id, name, source, prebuilt_id, created_at, updated_at, deleted_at, server_seq)
      VALUES ('01920000-0000-7000-8000-000000000003', 'u1', 'Old API', 'user', NULL, 5, 5, NULL, nextval('change_seq'))`);
    const { rows } = await db.query(
      `SELECT catalog_slug, catalog_version FROM decks WHERE id = '01920000-0000-7000-8000-000000000003'`,
    );
    expect(rows[0]).toEqual({ catalog_slug: null, catalog_version: null });
  });

  it('catalog versions are immutable, and a deck’s status is published or unlisted', async () => {
    await db.query(`INSERT INTO catalog_deck (slug, latest_version) VALUES ('d', 1)`);
    await db.query(`
      INSERT INTO catalog_deck_version (slug, version, content, checksum, card_count, type_counts)
      VALUES ('d', 1, '{}', 'x', 0, '{}')`);
    await expect(db.query(`UPDATE catalog_deck_version SET checksum = 'y'`)).rejects.toThrow(
      /immutable/,
    );
    await expect(db.query(`DELETE FROM catalog_deck_version`)).rejects.toThrow(/immutable/);
    await expect(db.query(`UPDATE catalog_deck SET status = 'hidden'`)).rejects.toThrow(
      /catalog_deck_status_check/,
    );
    await expect(
      db.query(`
        INSERT INTO catalog_deck_version (slug, version, content, checksum, card_count, type_counts)
        VALUES ('unknown', 1, '{}', 'x', 0, '{}')`),
    ).rejects.toThrow(/foreign key/);
  });
});

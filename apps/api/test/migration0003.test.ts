import { readFileSync } from 'node:fs';
import { CardSchema, ReviewLogSchema } from '@recall/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCard, toLog, type CardRow, type LogRow } from '../src/sync/rows';
import { TEST_DATABASE_URL } from './testDb';

// The M6 migration (0003) against a database at the pre-M6 schema with realistic data:
// additive columns, every existing card backfilled as a basic card, logs without outcome.

const migration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const DB = 'recall_migration_test';
const admin = new URL(TEST_DATABASE_URL);
admin.pathname = '/postgres';
const target = new URL(TEST_DATABASE_URL);
target.pathname = `/${DB}`;

let db: pg.Client;

/** node-postgres returns BIGINT columns as strings; the API's row types hold bigints. */
type Raw = Record<string, unknown>;
const big = (v: unknown) => BigInt(String(v));
const bigOrNull = (v: unknown) => (v === null ? null : big(v));
const asCardRow = (r: Raw): CardRow => ({
  ...(r as unknown as CardRow),
  created_at: big(r.created_at),
  updated_at: big(r.updated_at),
  deleted_at: bigOrNull(r.deleted_at),
  server_seq: big(r.server_seq),
});
const asLogRow = (r: Raw): LogRow => ({
  ...(r as unknown as LogRow),
  reviewed_at: big(r.reviewed_at),
  voided_at: bigOrNull(r.voided_at),
  server_seq: big(r.server_seq),
});

beforeAll(async () => {
  const a = new pg.Client({ connectionString: admin.toString() });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${DB}`);
  await a.query(`CREATE DATABASE ${DB}`);
  await a.end();

  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  await db.query(migration('0001_init'));
  await db.query(migration('0002_events'));

  // Realistic pre-M6 data: two users, a ready-made deck, multi-line text, a tombstone,
  // review history with an undo.
  await db.query(`
    INSERT INTO users (id, email) VALUES ('u1', 'a@example.com'), ('u2', 'b@example.com');
    INSERT INTO decks (id, user_id, name, source, prebuilt_id, created_at, updated_at, deleted_at, server_seq) VALUES
      ('01920000-0000-7000-8000-000000000001', 'u1', 'DBMS', 'prebuilt', 'dbms-basics-v1', 1, 1, NULL, nextval('change_seq')),
      ('01920000-0000-7000-8000-000000000002', 'u2', 'Mine', 'user', NULL, 1, 1, NULL, nextval('change_seq'));
    INSERT INTO cards (id, user_id, deck_id, front, back, created_at, updated_at, deleted_at, server_seq) VALUES
      ('01920000-0000-7000-8000-000000000101', 'u1', '01920000-0000-7000-8000-000000000001',
       E'Which is true?\\nA. one\\nB. two', E'• B\\n• because', 10, 20, NULL, nextval('change_seq')),
      ('01920000-0000-7000-8000-000000000102', 'u1', '01920000-0000-7000-8000-000000000001',
       'Deleted card', 'gone', 10, 30, 30, nextval('change_seq')),
      ('01920000-0000-7000-8000-000000000103', 'u2', '01920000-0000-7000-8000-000000000002',
       'Unicode: café “quotes”', 'ok', 11, 11, NULL, nextval('change_seq'));
    INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, voided_at, server_seq) VALUES
      ('01920000-0000-7000-8000-000000001001', 'u1', '01920000-0000-7000-8000-000000000101', 3, 100, 5000, 'dev', NULL, nextval('change_seq')),
      ('01920000-0000-7000-8000-000000001002', 'u1', '01920000-0000-7000-8000-000000000101', 1, 200, 4000, 'dev', 250, nextval('change_seq'));
  `);
});

afterAll(async () => {
  await db.end();
});

describe('migration 0003_question_types', () => {
  it('applies to a populated pre-M6 database', async () => {
    const before = await db.query<{ id: string; server_seq: string }>(
      'SELECT id, server_seq FROM cards ORDER BY id',
    );
    await db.query(migration('0003_question_types'));
    // Backfilling must not bump server_seq: devices would re-download every card.
    const after = await db.query<{ id: string; server_seq: string }>(
      'SELECT id, server_seq FROM cards ORDER BY id',
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('backfills every card as a basic card with identical front/back', async () => {
    const { rows } = await db.query<{ id: string; type: string; content: unknown; unit: null }>(
      'SELECT id, type, content, unit, source_key, source_hash FROM cards ORDER BY id',
    );
    expect(rows).toEqual([
      {
        id: '01920000-0000-7000-8000-000000000101',
        type: 'basic',
        content: { type: 'basic', front: 'Which is true?\nA. one\nB. two', back: '• B\n• because' },
        unit: null,
        source_key: null,
        source_hash: null,
      },
      {
        id: '01920000-0000-7000-8000-000000000102',
        type: 'basic',
        content: { type: 'basic', front: 'Deleted card', back: 'gone' },
        unit: null,
        source_key: null,
        source_hash: null,
      },
      {
        id: '01920000-0000-7000-8000-000000000103',
        type: 'basic',
        content: { type: 'basic', front: 'Unicode: café “quotes”', back: 'ok' },
        unit: null,
        source_key: null,
        source_hash: null,
      },
    ]);
  });

  it('every migrated card and log is valid under the M6 schemas; history is unchanged', async () => {
    const cards = await db.query<Raw>('SELECT * FROM cards ORDER BY id');
    for (const row of cards.rows) {
      const c = toCard(asCardRow(row));
      expect(CardSchema.parse(c)).toEqual(c);
    }
    const logs = await db.query<Raw>('SELECT * FROM review_logs ORDER BY id');
    const parsed = logs.rows.map((row) => ReviewLogSchema.parse(toLog(asLogRow(row))));
    expect(parsed.map((l) => [l.rating, l.reviewedAt, l.voidedAt, l.outcome])).toEqual([
      [3, 100, null, null],
      [1, 200, 250, null],
    ]);
  });

  it('is additive: pre-M6 code can still insert a card (type defaults to basic, content may be null)', async () => {
    await db.query(`
      INSERT INTO cards (id, user_id, deck_id, front, back, created_at, updated_at, deleted_at, server_seq)
      VALUES ('01920000-0000-7000-8000-000000000104', 'u2', '01920000-0000-7000-8000-000000000002',
              'Written by the old API', 'after a rollback', 12, 12, NULL, nextval('change_seq'))`);
    const { rows } = await db.query<Raw>(
      `SELECT * FROM cards WHERE id = '01920000-0000-7000-8000-000000000104'`,
    );
    const row = rows[0] ?? {};
    expect(row).toMatchObject({ type: 'basic', content: null });
    // …and the new code reads it as a basic card.
    const c = toCard(asCardRow(row));
    expect(CardSchema.parse(c)).toMatchObject({
      type: 'basic',
      content: { type: 'basic', front: 'Written by the old API', back: 'after a rollback' },
    });
  });
});

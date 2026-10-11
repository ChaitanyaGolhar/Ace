import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPrisma, DAY, HOUR, resetDb, testPrisma } from './helpers';

// Feel pass: after "Welcome back" (break_return_shown), what share of users start a
// session within 24 hours, capped ("Start with 20") vs full. Answers worked out by hand.

const sql = readFileSync(new URL('../analytics.sql', import.meta.url), 'utf8');
const query = (name: string) => {
  const parts = sql.split(/^-- name: (\w+)\s*$/m);
  const i = parts.indexOf(name);
  if (i === -1) throw new Error(`no query named ${name}`);
  return (parts[i + 1] ?? '').trim().replace(/;\s*$/, '');
};

const prisma = testPrisma();
const T = Date.UTC(2026, 9, 12, 4);
const MINUTE = 60_000;
let n = 0;
const id = () => `01920000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

const event = (user: string, type: string, at: number, props: object, device = 'dev') =>
  prisma.$executeRawUnsafe(
    `INSERT INTO events (id, user_id, type, occurred_at, device_id, props, server_seq)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, nextval('change_seq'))`,
    id(),
    user,
    type,
    at,
    device,
    JSON.stringify(props),
  );
const shown = (user: string, at: number) =>
  event(user, 'break_return_shown', at, { due: 45, daysAway: 4 });
const fullSession = (user: string, at: number, device = 'dev') =>
  event(user, 'session_started', at, { scope: 'all', due: 45, new: 0 }, device);
async function cappedSession(user: string, at: number, device = 'dev') {
  await fullSession(user, at, device);
  await event(user, 'capped_session_started', at + 1, { cap: 20, due: 45 }, device);
}

beforeAll(async () => {
  await resetDb();
  for (const u of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
    await prisma.$executeRawUnsafe(
      'INSERT INTO users (id, email) VALUES ($1, $2)',
      u,
      `${u}@example.com`,
    );
  }
  // b1: shown, starts with 20 a minute later → capped.
  await shown('b1', T);
  await cappedSession('b1', T + MINUTE);
  // b2: shown, reviews all two hours later → full.
  await shown('b2', T);
  await fullSession('b2', T + 2 * HOUR);
  // b3: shown, nothing within 24 h (a session two days later doesn't count).
  await shown('b3', T);
  await fullSession('b3', T + 2 * DAY);
  // b4: a full session before any showing doesn't count; shown twice, capped after the
  // second showing → capped only.
  await fullSession('b4', T - HOUR);
  await shown('b4', T);
  await shown('b4', T + 3 * DAY);
  await cappedSession('b4', T + 3 * DAY + 5 * MINUTE);
  // b5: never shown (studies anyway) → not counted at all.
  await cappedSession('b5', T);
  // b6: shown; a full session on one device while another device starts a capped one →
  // both (each session is classified on its own device).
  await shown('b6', T);
  await fullSession('b6', T + MINUTE, 'phone');
  await cappedSession('b6', T + MINUTE, 'laptop');
});

afterAll(async () => {
  await resetDb();
  await closeTestPrisma();
});

describe('break_return_sessions (feel pass)', () => {
  it('of users shown "Welcome back": started any / capped / full within 24 h, and shares', async () => {
    expect(await prisma.$queryRawUnsafe(query('break_return_sessions'))).toEqual([
      {
        users_shown: 5,
        started_any: 4,
        started_capped: 3,
        started_full: 2,
        share_any: 0.8,
        share_capped: 0.6,
        share_full: 0.4,
      },
    ]);
  });
});

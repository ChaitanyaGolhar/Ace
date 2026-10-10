import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPrisma, DAY, HOUR, MINUTE, resetDb, testPrisma } from './helpers';

// Every named query in analytics.sql runs against a small, hand-made fixture whose
// answers were worked out by hand (brief M4).

const sql = readFileSync(new URL('../analytics.sql', import.meta.url), 'utf8');

/** `-- name: foo` starts a query; it runs until the next name or the end of the file. */
function queries(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = text.split(/^-- name: (\w+)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    out.set(parts[i] ?? '', (parts[i + 1] ?? '').trim().replace(/;\s*$/, ''));
  }
  return out;
}

const Q = queries(sql);
const prisma = testPrisma();
const run = (name: string, ...params: unknown[]) => {
  const q = Q.get(name);
  if (!q) throw new Error(`no query named ${name}`);
  return prisma.$queryRawUnsafe<Record<string, unknown>[]>(q, ...params);
};

/** Monday 2026-09-07 00:00 UTC. */
const W0 = Date.UTC(2026, 8, 7);
let n = 0;
const id = () => `fixture-${String(++n).padStart(4, '0')}`;

async function user(userId: string) {
  await prisma.$executeRawUnsafe(
    'INSERT INTO users (id, email) VALUES ($1, $2)',
    userId,
    `${userId}@example.com`,
  );
}

async function event(userId: string, type: string, at: number, props: object = {}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO events (id, user_id, type, occurred_at, device_id, props, server_seq)
     VALUES ($1, $2, $3, $4, 'dev', $5::jsonb, nextval('change_seq'))`,
    id(),
    userId,
    type,
    at,
    JSON.stringify(props),
  );
}

async function review(userId: string, cardId: string, at: number, rating: number, voided = false) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, voided_at, server_seq)
     VALUES ($1, $2, $3, $4, $5, 1000, 'dev', $6, nextval('change_seq'))`,
    id(),
    userId,
    cardId,
    rating,
    at,
    voided ? at + MINUTE : null,
  );
}

beforeAll(async () => {
  await resetDb();
  for (const u of ['u1', 'u2', 'u3']) await user(u);

  // u1: first seen W0+1h, first review 5 min later; returns on day 1 and day 7.
  await event('u1', 'app_opened', W0 + HOUR);
  await event('u1', 'session_started', W0 + HOUR, { scope: 'all', due: 0, new: 2 });
  await event('u1', 'first_review_completed', W0 + HOUR + 5 * MINUTE);
  await event('u1', 'session_completed', W0 + HOUR + 10 * MINUTE, { reviewed: 4, durationMs: 1 });
  await event('u1', 'app_opened', W0 + DAY + 2 * HOUR);
  await event('u1', 'app_opened', W0 + 7 * DAY + HOUR);
  await event('u1', 'session_started', W0 + 7 * DAY + HOUR, { scope: 'all', due: 3, new: 0 });
  await event('u1', 'session_abandoned', W0 + 7 * DAY + HOUR + 2 * MINUTE, {
    reviewed: 1,
    remaining: 2,
  });
  // A second device's first review: the earliest one counts.
  await event('u1', 'first_review_completed', W0 + 2 * DAY);

  // u2: first seen W0+2h, first review 30 min later; back on day 3 (neither D1 nor D7).
  await event('u2', 'app_opened', W0 + 2 * HOUR);
  await event('u2', 'session_started', W0 + 2 * HOUR, { scope: 'deck', due: 0, new: 1 });
  await event('u2', 'first_review_completed', W0 + 2 * HOUR + 30 * MINUTE);
  await event('u2', 'session_completed', W0 + 2 * HOUR + 40 * MINUTE, {
    reviewed: 1,
    durationMs: 1,
  });
  await event('u2', 'app_opened', W0 + 3 * DAY);

  // u3: opened once, started a session, never reviewed.
  await event('u3', 'app_opened', W0 + 3 * HOUR);
  await event('u3', 'session_started', W0 + 3 * HOUR, { scope: 'all', due: 0, new: 5 });

  // Reviews. "Review-state" = previous non-voided review of the card ≥ 1 day earlier.
  await review('u1', 'c1', W0 + HOUR + 5 * MINUTE, 3); // first ever: not counted
  await review('u1', 'c1', W0 + 2 * DAY, 3); // counted, passed
  await review('u1', 'c1', W0 + 7 * DAY + HOUR, 1); // counted, failed (Again)
  await review('u1', 'c2', W0 + HOUR + 6 * MINUTE, 3); // first ever
  await review('u1', 'c2', W0 + HOUR + 20 * MINUTE, 2); // < 1 day later: learning, not counted
  await review('u1', 'c2', W0 + 3 * DAY, 3, true); // voided (undone): ignored everywhere
  await review('u1', 'c2', W0 + 3 * DAY + MINUTE, 4); // counted, passed
  await review('u2', 'c3', W0 + 2 * HOUR + 30 * MINUTE, 3); // first ever
  await review('u2', 'c3', W0 + 15 * DAY, 2); // counted, passed (Hard is a pass)
  await review('u3', 'c4', W0 + 9 * DAY, 3, true); // voided only: u3 never active
});

afterAll(async () => {
  await resetDb();
  await closeTestPrisma();
});

describe('analytics.sql', () => {
  it('has exactly the brief’s queries', () => {
    expect([...Q.keys()].sort()).toEqual([
      'catalog_deck_funnel', // M7 (BUILD_BRIEF_M6_M8 §7.8), tested in analyticsCatalog.test.ts
      'due_review_completion_rate',
      'return_rate',
      'time_to_first_review',
      'true_retention',
      'weekly_active_learners',
    ]);
  });

  it('time_to_first_review: first event → earliest first_review_completed, per user', async () => {
    expect(await run('time_to_first_review')).toEqual([
      { user_id: 'u1', ms_to_first_review: 5 * MINUTE },
      { user_id: 'u2', ms_to_first_review: 30 * MINUTE },
      { user_id: 'u3', ms_to_first_review: null },
    ]);
  });

  it('return_rate: D1/D7/D30 among users old enough to be measured', async () => {
    expect(await run('return_rate', W0 + 10 * DAY)).toEqual([
      { day: 1, eligible: 3, returned: 1, rate: 0.3333 },
      { day: 7, eligible: 3, returned: 1, rate: 0.3333 },
      { day: 30, eligible: 0, returned: 0, rate: null },
    ]);
    // Halfway through everyone's day 7, D7 can't be measured yet.
    expect(await run('return_rate', W0 + 7 * DAY + 12 * HOUR)).toEqual([
      { day: 1, eligible: 3, returned: 1, rate: 0.3333 },
      { day: 7, eligible: 0, returned: 0, rate: null },
      { day: 30, eligible: 0, returned: 0, rate: null },
    ]);
  });

  it('weekly_active_learners: distinct users with a non-voided review, per UTC week', async () => {
    expect(await run('weekly_active_learners')).toEqual([
      { week_start: '2026-09-07', learners: 2 },
      { week_start: '2026-09-14', learners: 1 },
      { week_start: '2026-09-21', learners: 1 },
    ]);
  });

  it('due_review_completion_rate: completed / started sessions, per UTC week', async () => {
    expect(await run('due_review_completion_rate')).toEqual([
      { week_start: '2026-09-07', started: 3, completed: 2, abandoned: 0, rate: 0.6667 },
      { week_start: '2026-09-14', started: 1, completed: 0, abandoned: 1, rate: 0 },
    ]);
  });

  it('true_retention: share of review-state reviews not rated Again, per user', async () => {
    expect(await run('true_retention')).toEqual([
      { user_id: 'u1', reviews: 3, passed: 2, retention: 0.6667 },
      { user_id: 'u2', reviews: 1, passed: 1, retention: 1 },
    ]);
  });
});

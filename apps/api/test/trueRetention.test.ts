import { readFileSync } from 'node:fs';
import {
  applyReview,
  cardFields,
  computeStats,
  initialState,
  studyDayKey,
  type Card,
  type Deck,
  type ReviewLog,
} from '@recall/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPrisma, DAY, HOUR, MINUTE, resetDb, testPrisma } from './helpers';

// Two implementations of "true retention" exist on purpose: the app's (core
// computeStats, which replays each card's FSRS state) and the server's
// (analytics.sql true_retention, which has no card state and treats "previous review
// ≥ 1 day earlier" as review state). This runs one history through both, to pin down
// exactly where they differ. The app's number is the brief's definition; the SQL's is
// an approximation (DECISIONS D-314).

const sql = readFileSync(new URL('../analytics.sql', import.meta.url), 'utf8');
const parts = sql.split(/^-- name: (\w+)\s*$/m);
const trueRetentionSql = (parts[parts.indexOf('true_retention') + 1] ?? '')
  .trim()
  .replace(/;\s*$/, '');

const prisma = testPrisma();
const T = Date.UTC(2026, 8, 1, 8); // day 0, 08:00 UTC
const ROLLOVER = 4;

const deck: Deck = {
  id: 'deck',
  name: 'D',
  source: 'user',
  prebuiltId: null,
  createdAt: T - DAY,
  updatedAt: T - DAY,
  deletedAt: null,
};
const card = (id: string): Card => ({
  id,
  deckId: deck.id,
  ...cardFields({ type: 'basic', front: 'q', back: 'a' }),
  unit: null,
  sourceKey: null,
  sourceHash: null,
  createdAt: T - DAY,
  updatedAt: T - DAY,
  deletedAt: null,
});
let n = 0;
const log = (cardId: string, at: number, rating: 1 | 2 | 3 | 4): ReviewLog => ({
  id: `log-${String(++n).padStart(3, '0')}`,
  cardId,
  rating,
  reviewedAt: at,
  durationMs: 1000,
  deviceId: 'dev',
  voidedAt: null,
  outcome: null,
});

// A: a typical history. Both definitions agree.
const a = [
  log('A', T, 4), // new → review (8 days)
  log('A', T + 8 * DAY, 3), // review: remembered ✓
  log('A', T + 20 * DAY, 1), // review: forgot ✗ → relearning
  log('A', T + 20 * DAY + 10 * MINUTE, 3), // relearning step: not a review-state review
];
// B: failed when new, seen again the next day. Still in learning, so the app skips it;
// the SQL sees a ≥ 1 day gap and counts it (a pass).
const b = [log('B', T + 2 * DAY, 1), log('B', T + 3 * DAY, 3)];
// C: graduates with a 1-day interval in the evening, then is reviewed the next
// morning (review cards are due for the whole study day). In review state, so the app
// counts it (a fail); the gap is < 24 h, so the SQL skips it.
const c0 = T + 4 * DAY + 10 * HOUR; // day 4, 18:00
const c = [
  log('C', c0, 1),
  log('C', c0 + MINUTE, 3),
  log('C', c0 + 11 * MINUTE, 3), // → review, due 24 h later
  log('C', c0 + 11 * MINUTE + 13 * HOUR, 1), // day 5, 07:11: review-state, forgot ✗
];
const logs = [...a, ...b, ...c];

/** The FSRS state of the card just before each of its reviews. */
function statesBefore(history: ReviewLog[]) {
  let state = initialState(card(history[0]?.cardId ?? ''));
  return history.map((l) => {
    const before = state;
    state = applyReview(state, l);
    return before;
  });
}

beforeAll(async () => {
  await resetDb();
  for (const l of logs) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, voided_at, server_seq)
       VALUES ($1, 'u', $2, $3, $4, 1000, 'dev', NULL, nextval('change_seq'))`,
      l.id,
      l.cardId,
      l.rating,
      l.reviewedAt,
    );
  }
});

afterAll(async () => {
  await resetDb();
  await closeTestPrisma();
});

describe('true retention: the app (core computeStats) vs the server (analytics.sql)', () => {
  it('the fixture is realistic: B is still learning, C is in review and due when reviewed', () => {
    expect(statesBefore(b).map((s) => s.state)).toEqual(['new', 'learning']);
    const cBefore = statesBefore(c);
    expect(cBefore.map((s) => s.state)).toEqual(['new', 'learning', 'learning', 'review']);
    const due = cBefore[3]?.due ?? 0;
    const reviewedAt = c[3]?.reviewedAt ?? 0;
    expect(studyDayKey(reviewedAt, 'UTC', ROLLOVER)).toBe(studyDayKey(due, 'UTC', ROLLOVER));
  });

  it('the app counts exactly the reviews of cards in review state: 1 of 3 (33%)', () => {
    const stats = computeStats({
      decks: [deck],
      cards: [card('A'), card('B'), card('C')],
      states: new Map(),
      logs,
      now: T + 25 * DAY,
      timeZone: 'UTC',
      rolloverHour: ROLLOVER,
    });
    // A day 8 ✓, A day 20 ✗, C day 5 ✗.
    expect(stats.retention).toEqual({ percent: 33, reviews: 3 });
  });

  it('the SQL approximation counts B instead of C: 2 of 3 (67%)', async () => {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(trueRetentionSql);
    // A day 8 ✓, A day 20 ✗, B day 3 ✓ (really a learning step).
    expect(rows).toEqual([{ user_id: 'u', reviews: 3, passed: 2, retention: 0.6667 }]);
  });
});

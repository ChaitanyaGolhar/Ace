// Stats (brief §10 screen 7, M4), moved from apps/web in the post-M4 audit.
import { describe, expect, it } from 'vitest';
import {
  computeStats,
  type Card,
  type CardState,
  type Deck,
  type ReviewLog,
  type StatsInput,
} from '../src';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Fixture: UTC, rollover 00:00, so study days are plain UTC dates.
// "Today" is Saturday 2026-10-10.
const NOW = Date.parse('2026-10-10T12:00:00Z');
const day = (offset: number, hour = 9) =>
  Date.parse('2026-10-10T00:00:00Z') + offset * DAY + hour * 60 * MINUTE;
const id = (n: number) => `01920000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const deck: Deck = {
  id: id(1),
  name: 'D',
  source: 'user',
  prebuiltId: null,
  createdAt: day(-60),
  updatedAt: day(-60),
  deletedAt: null,
};
const card = (n: number, deletedAt: number | null = null): Card => ({
  id: id(n),
  deckId: deck.id,
  front: 'q',
  back: 'a',
  createdAt: day(-60),
  updatedAt: day(-60),
  deletedAt,
});
const c1 = card(11); // long history: learned, then forgot
const c2 = card(12); // never seen
const c3 = card(13, day(-1, 20)); // deleted: never counts
const c4 = card(14); // first seen today
const c5 = card(15); // learned 10 days ago

let logN = 100;
const log = (c: Card, at: number, rating: 1 | 2 | 3 | 4, voidedAt: number | null = null) => ({
  id: id(logN++),
  cardId: c.id,
  rating,
  reviewedAt: at,
  durationMs: 5000,
  deviceId: 'd',
  voidedAt,
});

const logs: ReviewLog[] = [
  // c1: new → learning (day −40), → review (day −39), both outside the 30-day window.
  log(c1, day(-40), 3),
  log(c1, day(-39), 4),
  log(c1, day(-5), 3), // in review: remembered ✓
  log(c1, day(-3), 1, day(-3, 10)), // undone: ignored everywhere
  log(c1, day(-2), 1), // in review: forgot ✗ → relearning
  log(c1, day(0), 3), // relearning: not a review-state review
  // c3 (deleted): reviews never count.
  log(c3, day(-20), 4),
  log(c3, day(-1), 3),
  // c4: first review today (new → learning).
  log(c4, day(0, 10), 1),
  // c5: first review 10 days ago.
  log(c5, day(-10), 4),
  // Exactly at the window edges.
  log(c5, day(-30, 23), 3), // day −30: outside
];

const states = new Map<string, CardState>([
  [c1.id, mkState(c1, 'relearning', NOW + 10 * MINUTE)],
  [c2.id, mkState(c2, 'new', c2.createdAt)],
  [c3.id, mkState(c3, 'review', NOW)],
  [c4.id, mkState(c4, 'learning', NOW + MINUTE)],
  [c5.id, mkState(c5, 'review', day(2))],
]);

function mkState(c: Card, state: CardState['state'], due: number): CardState {
  return {
    cardId: c.id,
    due,
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state,
    lastReviewedAt: null,
    learningSteps: 0,
  };
}

const input: StatsInput = {
  decks: [deck],
  cards: [c1, c2, c3, c4, c5],
  states,
  logs,
  now: NOW,
  timeZone: 'UTC',
  rolloverHour: 0,
};

describe('computeStats (fixture of known logs)', () => {
  const stats = computeStats(input);

  it('true retention: share of reviews of cards in review state not rated Again (30 days)', () => {
    // Counted: c1 day −5 (Good) and c1 day −2 (Again). c1 today was relearning; c4 and
    // c5 were new; c3 is deleted; the undone review is ignored.
    expect(stats.retention).toEqual({ percent: 50, reviews: 2 });
  });

  it('counts non-undone reviews of live cards in the last 30 days', () => {
    // c1: −5, −2, today; c4: today; c5: −10. (c1 −3 undone; c3 deleted; c5 −30 outside.)
    expect(stats.reviews).toBe(5);
    expect(stats.daysStudied).toBe(4);
    expect(stats.averagePerStudiedDay).toBe(1); // round(5 / 4)
  });

  it('reviews per day: 30 study days, oldest first, ending today', () => {
    expect(stats.perDay).toHaveLength(30);
    expect(stats.perDay[0]?.day).toBe('2026-09-11');
    expect(stats.perDay[29]).toEqual({ day: '2026-10-10', count: 2 });
    const nonZero = stats.perDay.filter((d) => d.count > 0);
    expect(nonZero).toEqual([
      { day: '2026-09-30', count: 1 },
      { day: '2026-10-05', count: 1 },
      { day: '2026-10-08', count: 1 },
      { day: '2026-10-10', count: 2 },
    ]);
  });

  it('due forecast for the next 7 study days, today including overdue and learning', () => {
    expect(stats.forecast).toEqual([
      { day: '2026-10-10', label: 'Today', count: 2 },
      { day: '2026-10-11', label: 'Sun', count: 0 },
      { day: '2026-10-12', label: 'Mon', count: 1 },
      { day: '2026-10-13', label: 'Tue', count: 0 },
      { day: '2026-10-14', label: 'Wed', count: 0 },
      { day: '2026-10-15', label: 'Thu', count: 0 },
      { day: '2026-10-16', label: 'Fri', count: 0 },
    ]);
  });

  it('cards by state, live cards only', () => {
    expect(stats.cardsByState).toEqual({ learned: 1, learning: 2, notSeen: 1 });
  });

  it('retention is null with no review-state reviews', () => {
    const empty = computeStats({ ...input, logs: [] });
    expect(empty.retention).toEqual({ percent: null, reviews: 0 });
    expect(empty.reviews).toBe(0);
    expect(empty.daysStudied).toBe(0);
    expect(empty.averagePerStudiedDay).toBeNull();
  });

  it('excludes cards of a deleted deck', () => {
    const gone = computeStats({ ...input, decks: [{ ...deck, deletedAt: NOW }] });
    expect(gone.reviews).toBe(0);
    expect(gone.cardsByState).toEqual({ learned: 0, learning: 0, notSeen: 0 });
    expect(gone.forecast.every((d) => d.count === 0)).toBe(true);
  });

  it('uses study days (rollover hour), not calendar days', () => {
    // With a 04:00 rollover, a review at 02:00 on Oct 10 belongs to Oct 9.
    const late = computeStats({
      ...input,
      rolloverHour: 4,
      logs: [log(c4, day(0, 2), 3)],
    });
    expect(late.perDay.find((d) => d.count > 0)?.day).toBe('2026-10-09');
  });
});

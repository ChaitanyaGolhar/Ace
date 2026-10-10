import { mergeLog } from './merge';
import { applyReview, initialState } from './scheduler';
import type { Card, Deck, ReviewLog } from './schemas';
import { endOfStudyDay, studyDayKey } from './studyDay';
import type { CardState } from './types';

// Stats screen (brief §10, screen 7). Pure functions over decks, cards, stored card
// states and the review log. Tombstoned cards and decks never count (invariant 6).

const WINDOW_DAYS = 30;
const FORECAST_DAYS = 7;

export interface StatsInput {
  decks: Deck[];
  cards: Card[];
  states: Map<string, CardState>;
  logs: ReviewLog[];
  now: number;
  timeZone: string;
  rolloverHour: number;
}

export interface StatsData {
  /** "Remembered on review": reviews of cards in `review` state not rated Again, last 30 days. */
  retention: { percent: number | null; reviews: number };
  /** Non-undone reviews in the last 30 days. */
  reviews: number;
  /** Study days with at least one review, out of the last 30. */
  daysStudied: number;
  averagePerStudiedDay: number | null;
  /** 30 study days, oldest first; the last entry is today. */
  perDay: { day: string; count: number }[];
  /** Today (incl. overdue and learning) and the next 6 study days. */
  forecast: { day: string; label: string; count: number }[];
  cardsByState: { learned: number; learning: number; notSeen: number };
}

/** Study-day key `n` days after `key` ("2026-10-10", -1 → "2026-10-09"). */
function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${key}T12:00:00Z`),
  );
}

/** Each card's logs, de-duplicated (mergeLog), non-voided and in replay order. */
function activeLogsByCard(logs: ReviewLog[], cardIds: Set<string>): Map<string, ReviewLog[]> {
  const byId = new Map<string, ReviewLog>();
  for (const log of logs) {
    if (!cardIds.has(log.cardId)) continue;
    const existing = byId.get(log.id);
    byId.set(log.id, existing ? mergeLog(existing, log) : log);
  }
  const byCard = new Map<string, ReviewLog[]>();
  for (const log of byId.values()) {
    if (log.voidedAt !== null) continue;
    const list = byCard.get(log.cardId);
    if (list) list.push(log);
    else byCard.set(log.cardId, [log]);
  }
  for (const list of byCard.values()) {
    list.sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : 1));
  }
  return byCard;
}

export function computeStats(input: StatsInput): StatsData {
  const { now, timeZone, rolloverHour } = input;
  const dayOf = (t: number) => studyDayKey(t, timeZone, rolloverHour);
  const today = dayOf(now);
  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const inWindow = (key: string) => key >= windowStart && key <= today;

  const liveDeckIds = new Set(input.decks.filter((d) => d.deletedAt === null).map((d) => d.id));
  const liveCards = input.cards.filter((c) => c.deletedAt === null && liveDeckIds.has(c.deckId));
  const logsByCard = activeLogsByCard(input.logs, new Set(liveCards.map((c) => c.id)));

  // Replay each card step by step to know its state just before each review.
  const perDayCounts = new Map<string, number>();
  let retained = 0;
  let reviewStateReviews = 0;
  for (const card of liveCards) {
    let state = initialState(card);
    for (const log of logsByCard.get(card.id) ?? []) {
      const key = dayOf(log.reviewedAt);
      if (inWindow(key)) {
        perDayCounts.set(key, (perDayCounts.get(key) ?? 0) + 1);
        if (state.state === 'review') {
          reviewStateReviews += 1;
          if (log.rating !== 1) retained += 1;
        }
      }
      state = applyReview(state, log);
    }
  }

  const perDay = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const key = addDays(windowStart, i);
    return { day: key, count: perDayCounts.get(key) ?? 0 };
  });
  const reviews = perDay.reduce((sum, d) => sum + d.count, 0);
  const daysStudied = perDay.filter((d) => d.count > 0).length;

  const liveStates = liveCards.map((c) => input.states.get(c.id) ?? initialState(c));
  const endOfToday = endOfStudyDay(now, timeZone, rolloverHour);
  const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const key = addDays(today, i);
    const count = liveStates.filter(
      (s) => s.state !== 'new' && (i === 0 ? s.due < endOfToday : dayOf(s.due) === key),
    ).length;
    return { day: key, label: i === 0 ? 'Today' : weekday(key), count };
  });

  return {
    retention: {
      percent: reviewStateReviews === 0 ? null : Math.round((retained / reviewStateReviews) * 100),
      reviews: reviewStateReviews,
    },
    reviews,
    daysStudied,
    averagePerStudiedDay: daysStudied === 0 ? null : Math.round(reviews / daysStudied),
    perDay,
    forecast,
    cardsByState: {
      learned: liveStates.filter((s) => s.state === 'review').length,
      learning: liveStates.filter((s) => s.state === 'learning' || s.state === 'relearning').length,
      notSeen: liveStates.filter((s) => s.state === 'new').length,
    },
  };
}

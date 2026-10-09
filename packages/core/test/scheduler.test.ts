import { createEmptyCard, fsrs, Rating as FsrsRating, type Card as FsrsCard } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import {
  applyReview,
  DEFAULT_SCHEDULER_PARAMS,
  initialState,
  previewIntervals,
  replay,
  type CardState,
  type Rating,
  type ReviewLog,
} from '../src';
import { DAY, makeCard, makeLog, MINUTE, T0, uuid } from './helpers/fixtures';
import { pick, randomInt, seededRandom, shuffle } from './helpers/random';

const card = makeCard({ id: uuid(100), createdAt: T0 - DAY });
const RATINGS: readonly Rating[] = [1, 2, 3, 4];
const GRADE = {
  1: FsrsRating.Again,
  2: FsrsRating.Hard,
  3: FsrsRating.Good,
  4: FsrsRating.Easy,
} as const;

/** A realistic random review history for `card`: increasing times, some equal. */
function randomHistory(seed: number, length: number): ReviewLog[] {
  const rand = seededRandom(seed);
  let at = T0;
  return Array.from({ length }, (_, i) => {
    at += pick(rand, [0, MINUTE, 10 * MINUTE, DAY, 3 * DAY, 20 * DAY]);
    return makeLog({
      id: uuid(10_000 + i),
      cardId: card.id,
      rating: pick(rand, RATINGS),
      reviewedAt: at,
      durationMs: randomInt(rand, 500, 20_000),
    });
  });
}

function sortedLikeReplay(logs: ReviewLog[]): ReviewLog[] {
  return [...logs].sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : 1));
}

describe('initialState', () => {
  it('is a new, never-reviewed card due at creation', () => {
    expect(initialState(card)).toEqual<CardState>({
      cardId: card.id,
      due: card.createdAt,
      stability: 0,
      difficulty: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      lastReviewedAt: null,
      learningSteps: 0,
    });
  });
});

describe('applyReview', () => {
  it('follows the default learning steps for a new card (1m / 6m / 10m)', () => {
    const s0 = initialState(card);
    const rate = (rating: Rating) =>
      applyReview(s0, makeLog({ cardId: card.id, rating, reviewedAt: T0 }));
    expect(rate(1)).toMatchObject({ state: 'learning', due: T0 + MINUTE, reps: 1 });
    expect(rate(2)).toMatchObject({ state: 'learning', due: T0 + 6 * MINUTE });
    expect(rate(3)).toMatchObject({ state: 'learning', due: T0 + 10 * MINUTE });
    expect(rate(4).state).toBe('review');
    expect(rate(4).due).toBeGreaterThanOrEqual(T0 + DAY);
    expect(rate(3).lastReviewedAt).toBe(T0);
  });

  it('counts a lapse when a review card is rated Again', () => {
    const graduated = applyReview(
      initialState(card),
      makeLog({ cardId: card.id, rating: 4, reviewedAt: T0 }),
    );
    const lapsed = applyReview(
      graduated,
      makeLog({ id: uuid(2000), cardId: card.id, rating: 1, reviewedAt: graduated.due }),
    );
    expect(lapsed).toMatchObject({ state: 'relearning', lapses: 1, reps: 2 });
  });

  it('rejects a log for a different card', () => {
    expect(() => applyReview(initialState(card), makeLog({ cardId: uuid(999) }))).toThrow();
  });

  it('rejects a log older than the last review (logs must be applied in replay order)', () => {
    const s1 = applyReview(initialState(card), makeLog({ cardId: card.id, reviewedAt: T0 }));
    expect(() => applyReview(s1, makeLog({ cardId: card.id, reviewedAt: T0 - 1 }))).toThrow(
      RangeError,
    );
  });

  it('does not mutate its input', () => {
    const s0 = Object.freeze(initialState(card));
    expect(() => applyReview(s0, makeLog({ cardId: card.id }))).not.toThrow();
    expect(s0.reps).toBe(0);
  });

  it('is lossless: folding applyReview equals chaining ts-fsrs directly', () => {
    // Guards the wrapper: if CardState dropped a field ts-fsrs needs (e.g. the
    // learning-step index), the two would drift apart after a few reviews.
    const scheduler = fsrs({ enable_fuzz: false });
    for (let seed = 1; seed <= 50; seed++) {
      let ours = initialState(card);
      let theirs: FsrsCard = createEmptyCard(new Date(card.createdAt));
      for (const log of randomHistory(seed, 15)) {
        ours = applyReview(ours, log);
        theirs = scheduler.next(theirs, new Date(log.reviewedAt), GRADE[log.rating]).card;
        expect(ours).toEqual({
          cardId: card.id,
          due: theirs.due.getTime(),
          stability: theirs.stability,
          difficulty: theirs.difficulty,
          reps: theirs.reps,
          lapses: theirs.lapses,
          state: (['new', 'learning', 'review', 'relearning'] as const)[theirs.state],
          lastReviewedAt: theirs.last_review?.getTime() ?? null,
          learningSteps: theirs.learning_steps,
        });
      }
    }
  });

  it('honours custom scheduler params', () => {
    const graduated = (requestRetention: number) =>
      applyReview(initialState(card), makeLog({ cardId: card.id, rating: 4, reviewedAt: T0 }), {
        ...DEFAULT_SCHEDULER_PARAMS,
        requestRetention,
      });
    // Asking for lower retention means waiting longer before the next review.
    expect(graduated(0.7).due).toBeGreaterThan(graduated(0.9).due);
  });
});

describe('replay', () => {
  const logs = randomHistory(7, 25);

  it('with no logs is the initial state', () => {
    expect(replay(card, [])).toEqual(initialState(card));
  });

  it('matches applying the logs one by one with applyReview', () => {
    const expected = sortedLikeReplay(logs).reduce(
      (state, log) => applyReview(state, log),
      initialState(card),
    );
    expect(replay(card, logs)).toEqual(expected);
  });

  it('is order-independent: many seeded shuffles give identical output', () => {
    const expected = replay(card, logs);
    const rand = seededRandom(2026);
    for (let i = 0; i < 200; i++) {
      expect(replay(card, shuffle(rand, logs))).toEqual(expected);
    }
  });

  it('orders logs with the same reviewedAt by id', () => {
    const again = makeLog({ id: uuid(1), cardId: card.id, rating: 1, reviewedAt: T0 });
    const easy = makeLog({ id: uuid(2), cardId: card.id, rating: 4, reviewedAt: T0 });
    const inIdOrder = applyReview(applyReview(initialState(card), again), easy);
    expect(replay(card, [easy, again])).toEqual(inIdOrder);
    expect(replay(card, [again, easy])).toEqual(inIdOrder);
  });

  it('counts duplicate logs (same id) once', () => {
    const rand = seededRandom(99);
    const withDuplicates = shuffle(rand, [...logs, ...logs.slice(0, 10), ...logs.slice(5, 8)]);
    expect(replay(card, withDuplicates)).toEqual(replay(card, logs));
  });

  it('ignores a voided log: the state equals the state without that log', () => {
    const voidedIndex = 12;
    const withVoided = logs.map((log, i) => (i === voidedIndex ? { ...log, voidedAt: T0 } : log));
    const without = logs.filter((_, i) => i !== voidedIndex);
    expect(replay(card, withVoided)).toEqual(replay(card, without));
    expect(replay(card, withVoided)).not.toEqual(replay(card, logs));
  });

  it('treats a log as voided if any duplicate copy of it is voided', () => {
    const target = logs[3] as ReviewLog;
    const voidedCopy = { ...target, voidedAt: T0 };
    const without = logs.filter((log) => log.id !== target.id);
    expect(replay(card, [...logs, voidedCopy])).toEqual(replay(card, without));
    expect(replay(card, [voidedCopy, ...logs])).toEqual(replay(card, without));
  });

  it('ignores logs that belong to other cards', () => {
    const other = makeLog({ id: uuid(77), cardId: uuid(555), rating: 1, reviewedAt: T0 });
    expect(replay(card, [...logs, other])).toEqual(replay(card, logs));
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze(logs.map((log) => Object.freeze({ ...log })));
    const before = JSON.stringify(frozen);
    replay(card, shuffle(seededRandom(1), frozen));
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe('previewIntervals', () => {
  it('for a new card shows the learning steps and a graduating Easy interval', () => {
    const preview = previewIntervals(initialState(card), T0);
    expect(preview[1]).toBe(MINUTE);
    expect(preview[2]).toBe(6 * MINUTE);
    expect(preview[3]).toBe(10 * MINUTE);
    expect(preview[4]).toBeGreaterThanOrEqual(DAY);
  });

  it('matches what applyReview would actually schedule, for every rating', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const history = randomHistory(seed, 8);
      const state = replay(card, history);
      const now = (history.at(-1)?.reviewedAt ?? T0) + 2 * DAY;
      const preview = previewIntervals(state, now);
      for (const rating of RATINGS) {
        const next = applyReview(state, makeLog({ cardId: card.id, rating, reviewedAt: now }));
        expect(preview[rating]).toBe(next.due - now);
      }
    }
  });

  it('gives longer intervals for better ratings on a review card', () => {
    const state = replay(card, [makeLog({ cardId: card.id, rating: 4, reviewedAt: T0 })]);
    const p = previewIntervals(state, state.due);
    expect(p[1]).toBeLessThan(p[2]);
    expect(p[2]).toBeLessThan(p[3]);
    expect(p[3]).toBeLessThan(p[4]);
  });
});

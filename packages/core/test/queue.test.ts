import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  type Card,
  type CardState,
  type Deck,
  type QueueInput,
  type ReviewLog,
} from '../src';
import { DAY, HOUR, makeCard, makeDeck, makeLog, MINUTE, T0, uuid } from './helpers/fixtures';

// T0 is 2026-10-10T10:00Z = 15:30 IST. With a 04:00 rollover in Asia/Kolkata, today's
// study day ("2026-10-10") began at 2026-10-09T22:30Z.
const NOW = T0;
const START_OF_TODAY = Date.parse('2026-10-09T22:30:00Z');
const DECK = makeDeck({ id: uuid(1) });
const OTHER_DECK = makeDeck({ id: uuid(2), name: 'Other' });

function state(cardId: string, overrides: Partial<CardState> = {}): CardState {
  return {
    cardId,
    due: NOW,
    stability: 3,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 'review',
    lastReviewedAt: NOW - 3 * DAY,
    learningSteps: 0,
    ...overrides,
  };
}

function newCards(count: number, firstId: number, deckId = DECK.id): Card[] {
  return Array.from({ length: count }, (_, i) =>
    makeCard({ id: uuid(firstId + i), deckId, createdAt: T0 - DAY + i }),
  );
}

/** One first-review log per card, all reviewed at `at`. */
function firstReviews(cards: Card[], at: number): ReviewLog[] {
  return cards.map((card, i) => makeLog({ id: uuid(50_000 + i), cardId: card.id, reviewedAt: at }));
}

function input(overrides: Partial<QueueInput> = {}): QueueInput {
  return {
    decks: [DECK, OTHER_DECK],
    cards: [],
    states: new Map(),
    logs: [],
    now: NOW,
    timeZone: 'Asia/Kolkata',
    rolloverHour: 4,
    newPerDay: 20,
    ...overrides,
  };
}

function withStates(cards: Card[], states: CardState[]): Pick<QueueInput, 'cards' | 'states'> {
  return { cards, states: new Map(states.map((s) => [s.cardId, s])) };
}

describe('buildQueue: due cards', () => {
  it('includes non-new cards due now or earlier, ordered by due ascending', () => {
    const cards = [
      makeCard({ id: uuid(10) }),
      makeCard({ id: uuid(11) }),
      makeCard({ id: uuid(12) }),
    ];
    const q = buildQueue(
      input(
        withStates(cards, [
          state(uuid(10), { due: NOW }),
          state(uuid(11), { due: NOW - DAY, state: 'relearning' }),
          state(uuid(12), { due: NOW - HOUR, state: 'learning' }),
        ]),
      ),
    );
    expect(q.due).toEqual([uuid(11), uuid(12), uuid(10)]);
  });

  it('excludes cards due in the future and new cards', () => {
    const cards = [makeCard({ id: uuid(10) }), makeCard({ id: uuid(11) })];
    const q = buildQueue(
      input({
        ...withStates(cards, [
          state(uuid(10), { due: NOW + 1 }),
          state(uuid(11), { state: 'new' }),
        ]),
        newPerDay: 0,
      }),
    );
    expect(q.due).toEqual([]);
  });

  it('breaks ties on due by card id', () => {
    const cards = [makeCard({ id: uuid(21) }), makeCard({ id: uuid(20) })];
    const q = buildQueue(input(withStates(cards, [state(uuid(21)), state(uuid(20))])));
    expect(q.due).toEqual([uuid(20), uuid(21)]);
  });
});

describe('buildQueue: new cards', () => {
  it('offers new cards by createdAt ascending, up to newPerDay', () => {
    const cards = newCards(30, 100).reverse();
    const q = buildQueue(input({ cards }));
    expect(q.newCards).toEqual(newCards(20, 100).map((c) => c.id));
  });

  it('treats a card without a stored state as new', () => {
    const q = buildQueue(input({ cards: newCards(1, 100) }));
    expect(q.newCards).toEqual([uuid(100)]);
  });

  it('offers nothing new once 20 new cards were introduced today', () => {
    const studied = newCards(20, 100);
    const fresh = newCards(5, 200);
    const q = buildQueue(
      input({
        ...withStates(
          [...studied, ...fresh],
          studied.map((c) => state(c.id, { state: 'learning', due: NOW + HOUR })),
        ),
        logs: firstReviews(studied, START_OF_TODAY + HOUR),
      }),
    );
    expect(q.newCards).toEqual([]);
    expect(q.counts.new).toBe(0);
  });

  it('subtracts cards introduced today from the allowance', () => {
    const studied = newCards(15, 100);
    const fresh = newCards(10, 200);
    const q = buildQueue(
      input({
        ...withStates(
          [...studied, ...fresh],
          studied.map((c) => state(c.id, { due: NOW + DAY })),
        ),
        logs: firstReviews(studied, START_OF_TODAY),
      }),
    );
    expect(q.newCards).toEqual(fresh.slice(0, 5).map((c) => c.id));
  });

  it('does not count cards first reviewed before the rollover (yesterday)', () => {
    const studied = newCards(20, 100);
    const fresh = newCards(3, 200);
    const q = buildQueue(
      input({
        ...withStates(
          [...studied, ...fresh],
          studied.map((c) => state(c.id, { due: NOW + DAY })),
        ),
        // 03:59 IST today still belongs to yesterday's study day...
        logs: [
          ...firstReviews(studied, START_OF_TODAY - 1),
          // ...and later reviews of those cards today don't make them "new today".
          ...studied.map((c, i) =>
            makeLog({ id: uuid(70_000 + i), cardId: c.id, reviewedAt: NOW - HOUR }),
          ),
        ],
      }),
    );
    expect(q.newCards).toEqual(fresh.map((c) => c.id));
  });

  it('a voided first review frees up its slot', () => {
    const studied = newCards(20, 100);
    const fresh = newCards(3, 200);
    const logs = firstReviews(studied, START_OF_TODAY + HOUR);
    const undone = { ...(logs[0] as ReviewLog), voidedAt: NOW };
    const q = buildQueue(
      input({
        ...withStates(
          [...studied, ...fresh],
          // The undone card's state was recomputed by replay: it is new again.
          studied.map((c, i) => state(c.id, i === 0 ? { state: 'new' } : { due: NOW + DAY })),
        ),
        logs: [undone, ...logs.slice(1)],
      }),
    );
    expect(q.newCards).toEqual([uuid(100)]);
  });

  it('counts a card whose voided first review was followed by another review today', () => {
    const [card] = newCards(1, 100) as [Card];
    const logs = [
      makeLog({
        id: uuid(1),
        cardId: card.id,
        reviewedAt: START_OF_TODAY - DAY,
        voidedAt: START_OF_TODAY - DAY,
      }),
      makeLog({ id: uuid(2), cardId: card.id, reviewedAt: NOW - HOUR }),
    ];
    const q = buildQueue(
      input({
        ...withStates([card, ...newCards(2, 200)], [state(card.id, { due: NOW + DAY })]),
        logs,
        newPerDay: 2,
      }),
    );
    expect(q.newCards).toEqual([uuid(200)]);
  });

  it('counts duplicate copies of a log once, and a voided copy voids it', () => {
    const studied = newCards(2, 100);
    const logs = firstReviews(studied, NOW - HOUR);
    const q = buildQueue(
      input({
        ...withStates(
          [...studied, ...newCards(5, 200)],
          studied.map((c) => state(c.id, { due: NOW + DAY })),
        ),
        logs: [...logs, ...logs, { ...(logs[1] as ReviewLog), voidedAt: NOW }],
        newPerDay: 3,
      }),
    );
    expect(q.newCards).toEqual([uuid(200), uuid(201)]);
  });

  it('never goes negative and respects newPerDay = 0', () => {
    const studied = newCards(25, 100);
    const base = {
      ...withStates(
        [...studied, ...newCards(3, 200)],
        studied.map((c) => state(c.id, { due: NOW + DAY })),
      ),
      logs: firstReviews(studied, NOW - HOUR),
    };
    expect(buildQueue(input(base)).newCards).toEqual([]);
    expect(buildQueue(input({ cards: newCards(3, 200), newPerDay: 0 })).newCards).toEqual([]);
  });

  it('rejects an invalid newPerDay', () => {
    expect(() => buildQueue(input({ newPerDay: -1 }))).toThrow(RangeError);
    expect(() => buildQueue(input({ newPerDay: 2.5 }))).toThrow(RangeError);
  });
});

describe('buildQueue: learn-ahead', () => {
  function learnAheadFor(dueIn: number, cardState: CardState['state'] = 'learning') {
    const card = makeCard({ id: uuid(10) });
    return buildQueue(
      input(withStates([card], [state(card.id, { state: cardState, due: NOW + dueIn })])),
    ).learnAheadNext;
  }

  it('offers a learning card due 19:59 from now', () => {
    expect(learnAheadFor(19 * MINUTE + 59_000)).toEqual({
      cardId: uuid(10),
      due: NOW + 19 * MINUTE + 59_000,
    });
  });

  it('offers a card due exactly 20:00 from now', () => {
    expect(learnAheadFor(20 * MINUTE)).not.toBeNull();
  });

  it('does not offer a card due 20:01 from now', () => {
    expect(learnAheadFor(20 * MINUTE + 1_000)).toBeNull();
  });

  it('offers relearning cards but not review cards', () => {
    expect(learnAheadFor(5 * MINUTE, 'relearning')).not.toBeNull();
    expect(learnAheadFor(5 * MINUTE, 'review')).toBeNull();
  });

  it('picks the earliest-due learning card', () => {
    const cards = [makeCard({ id: uuid(10) }), makeCard({ id: uuid(11) })];
    const q = buildQueue(
      input(
        withStates(cards, [
          state(uuid(10), { state: 'learning', due: NOW + 10 * MINUTE }),
          state(uuid(11), { state: 'learning', due: NOW + 2 * MINUTE }),
        ]),
      ),
    );
    expect(q.learnAheadNext).toEqual({ cardId: uuid(11), due: NOW + 2 * MINUTE });
  });

  it('is null while something is due', () => {
    const cards = [makeCard({ id: uuid(10) }), makeCard({ id: uuid(11) })];
    const q = buildQueue(
      input(
        withStates(cards, [
          state(uuid(10), { state: 'review', due: NOW - DAY }),
          state(uuid(11), { state: 'learning', due: NOW + MINUTE }),
        ]),
      ),
    );
    expect(q.learnAheadNext).toBeNull();
  });
});

describe('buildQueue: deletion and filtering', () => {
  const live = makeCard({ id: uuid(10), deckId: DECK.id });
  const deletedCard = makeCard({ id: uuid(11), deckId: DECK.id, deletedAt: T0 });
  const inOther = makeCard({ id: uuid(12), deckId: OTHER_DECK.id });
  const all = [live, deletedCard, inOther];
  const dueStates = all.map((c) => state(c.id, { due: NOW - HOUR }));

  it('never includes tombstoned cards', () => {
    const q = buildQueue(input({ ...withStates(all, dueStates) }));
    expect(q.due).toEqual([uuid(10), uuid(12)]);
    const n = buildQueue(input({ cards: [deletedCard] }));
    expect(n.newCards).toEqual([]);
    const la = buildQueue(
      input(
        withStates(
          [deletedCard],
          [state(deletedCard.id, { state: 'learning', due: NOW + MINUTE })],
        ),
      ),
    );
    expect(la.learnAheadNext).toBeNull();
  });

  it('never includes cards of a tombstoned deck, even if the card itself is live', () => {
    const q = buildQueue(
      input({
        ...withStates(all, dueStates),
        decks: [{ ...DECK, deletedAt: T0 } satisfies Deck, OTHER_DECK],
      }),
    );
    expect(q.due).toEqual([uuid(12)]);
  });

  it('skips cards whose deck is unknown (e.g. not synced yet)', () => {
    const q = buildQueue(input({ ...withStates(all, dueStates), decks: [OTHER_DECK] }));
    expect(q.due).toEqual([uuid(12)]);
  });

  it('can be scoped to one deck', () => {
    const q = buildQueue(input({ ...withStates(all, dueStates), deckId: OTHER_DECK.id }));
    expect(q.due).toEqual([uuid(12)]);
  });

  it('applies the new-card limit across all decks even when scoped to one', () => {
    const studied = newCards(20, 100, OTHER_DECK.id);
    const q = buildQueue(
      input({
        ...withStates(
          [...studied, ...newCards(3, 200)],
          studied.map((c) => state(c.id, { due: NOW + DAY })),
        ),
        logs: firstReviews(studied, NOW - HOUR),
        deckId: DECK.id,
      }),
    );
    expect(q.newCards).toEqual([]);
  });
});

describe('buildQueue: counts', () => {
  it('splits due cards into review (due) and learning, plus new', () => {
    const cards = [...newCards(4, 10), ...newCards(3, 100)];
    const q = buildQueue(
      input({
        ...withStates(cards, [
          state(uuid(10), { state: 'review', due: NOW - DAY }),
          state(uuid(11), { state: 'review', due: NOW }),
          state(uuid(12), { state: 'learning', due: NOW - MINUTE }),
          state(uuid(13), { state: 'relearning', due: NOW - MINUTE }),
        ]),
      }),
    );
    expect(q.counts).toEqual({ due: 2, learning: 2, new: 3 });
    expect(q.due).toHaveLength(4);
  });
});

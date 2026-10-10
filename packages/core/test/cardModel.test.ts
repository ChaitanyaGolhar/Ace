import { describe, expect, it } from 'vitest';
import {
  BackupSchema,
  CardSchema,
  cardFields,
  lww,
  mergeLog,
  PROTOCOL_VERSION,
  PushRequestSchema,
  replay,
  ReviewLogSchema,
  sameRow,
  type CardContent,
} from '../src';
import { DAY, makeCard, makeDeck, makeLog, MINUTE, T0, uuid } from './helpers/fixtures';

// The card and review-log model after M6 (BUILD_BRIEF_M6_M8 §6.2, §6.4, §6.6).

const mcq: CardContent = {
  type: 'mcq',
  question: 'Pick B',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correct: 'b',
  explanation: null,
};
const long: CardContent = {
  type: 'long',
  question: 'Explain.',
  marks: 4,
  keyPoints: ['One', 'Two'],
  modelAnswer: null,
};

describe('CardSchema with type and content', () => {
  it('cardFields(content) gives type, content and the derived front/back', () => {
    expect(cardFields(mcq)).toEqual({
      type: 'mcq',
      content: mcq,
      front: 'Pick B\n\nA. A\nB. B',
      back: 'B — B',
    });
  });

  it('accepts a card of every type whose front/back are derived from its content', () => {
    for (const content of [
      { type: 'basic', front: 'Q', back: 'A' },
      mcq,
      { type: 'cloze', text: 'A {{b}} c', accepted: [], hint: null, extra: null },
      { type: 'short', question: 'Q', answer: 'A', explanation: null },
      long,
    ] as CardContent[]) {
      const card = makeCard({ ...cardFields(content) });
      expect(CardSchema.parse(card), content.type).toEqual(card);
    }
  });

  it('a pre-M6 card is a basic card with identical front/back', () => {
    const card = makeCard({ front: 'What is 2NF?', back: 'No partial dependency' });
    expect(card).toMatchObject({
      type: 'basic',
      content: { type: 'basic', front: 'What is 2NF?', back: 'No partial dependency' },
      unit: null,
      sourceKey: null,
      sourceHash: null,
    });
    expect(CardSchema.parse(card)).toEqual(card);
  });

  it('rejects a type that disagrees with the content, or display text that isn’t derived', () => {
    expect(CardSchema.safeParse({ ...makeCard(cardFields(mcq)), type: 'basic' }).success).toBe(
      false,
    );
    expect(CardSchema.safeParse({ ...makeCard(cardFields(mcq)), front: 'Pick B' }).success).toBe(
      false,
    );
    expect(CardSchema.safeParse({ ...makeCard(cardFields(mcq)), back: 'b' }).success).toBe(false);
  });

  it('rejects invalid content', () => {
    const bad = { ...mcq, correct: 'c' } as unknown as CardContent;
    expect(CardSchema.safeParse({ ...makeCard(), type: 'mcq', content: bad }).success).toBe(false);
  });

  it('unit is 1–99 or null; sourceKey/sourceHash are short strings or null', () => {
    expect(CardSchema.safeParse(makeCard({ unit: 1 })).success).toBe(true);
    expect(CardSchema.safeParse(makeCard({ unit: 99 })).success).toBe(true);
    expect(CardSchema.safeParse(makeCard({ unit: 0 })).success).toBe(false);
    expect(CardSchema.safeParse(makeCard({ unit: 1.5 })).success).toBe(false);
    expect(CardSchema.safeParse(makeCard({ sourceKey: 'u1-001', sourceHash: 'abc' })).success).toBe(
      true,
    );
    expect(CardSchema.safeParse(makeCard({ sourceKey: '' })).success).toBe(false);
    expect(CardSchema.safeParse(makeCard({ sourceKey: 'k'.repeat(101) })).success).toBe(false);
  });

  it('unit, sourceKey and sourceHash default to null when absent', () => {
    const { unit: _u, sourceKey: _k, sourceHash: _h, ...rest } = makeCard();
    expect(CardSchema.parse(rest)).toMatchObject({ unit: null, sourceKey: null, sourceHash: null });
  });
});

describe('ReviewLog outcome', () => {
  it('defaults to null (logs written before M6)', () => {
    const { outcome: _o, ...legacy } = makeLog();
    expect(ReviewLogSchema.parse(legacy).outcome).toBeNull();
  });

  it('accepts an outcome that agrees with the rating', () => {
    for (const [outcome, rating] of [
      [{ kind: 'mcq', selected: 'a', correct: false }, 1],
      [{ kind: 'mcq', selected: 'b', correct: true }, 4],
      [{ kind: 'cloze', mode: 'typed', correct: true }, 2],
      [{ kind: 'cloze', mode: 'typed', correct: false }, 1],
      [{ kind: 'cloze', mode: 'revealed', correct: null }, 1],
      [{ kind: 'long', hit: 1, total: 4, suggested: 1 }, 4],
    ] as const) {
      expect(
        ReviewLogSchema.safeParse(makeLog({ outcome, rating })).success,
        JSON.stringify(outcome),
      ).toBe(true);
    }
  });

  it('rejects a rating the outcome doesn’t allow', () => {
    expect(
      ReviewLogSchema.safeParse(
        makeLog({ outcome: { kind: 'mcq', selected: 'a', correct: false }, rating: 3 }),
      ).success,
    ).toBe(false);
    expect(
      ReviewLogSchema.safeParse(
        makeLog({ outcome: { kind: 'mcq', selected: 'b', correct: true }, rating: 1 }),
      ).success,
    ).toBe(false);
    expect(
      ReviewLogSchema.safeParse(
        makeLog({ outcome: { kind: 'cloze', mode: 'typed', correct: true }, rating: 1 }),
      ).success,
    ).toBe(false);
  });

  it('replay ignores outcomes: identical CardState with and without them', () => {
    const card = makeCard();
    const at = (n: number) => T0 + n * DAY;
    const plain = [
      makeLog({ id: uuid(2001), rating: 1, reviewedAt: at(0) }),
      makeLog({ id: uuid(2002), rating: 3, reviewedAt: at(0) + 10 * MINUTE }),
      makeLog({ id: uuid(2003), rating: 2, reviewedAt: at(2) }),
      makeLog({ id: uuid(2004), rating: 4, reviewedAt: at(9) }),
    ];
    const outcomes = [
      { kind: 'mcq', selected: 'a', correct: false },
      { kind: 'cloze', mode: 'revealed', correct: null },
      { kind: 'long', hit: 1, total: 2, suggested: 2 },
      { kind: 'mcq', selected: 'b', correct: true },
    ] as const;
    const withOutcomes = plain.map((l, i) => ({ ...l, outcome: outcomes[i] ?? null }));
    expect(replay(card, withOutcomes)).toEqual(replay(card, plain));
  });
});

describe('nested values merge and compare by content, not key order', () => {
  it('sameRow ignores key order inside content', () => {
    const a = makeCard(cardFields(mcq));
    const reordered = {
      ...a,
      content: {
        explanation: null,
        correct: 'b',
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        question: 'Pick B',
        type: 'mcq',
      },
    };
    expect(sameRow(a, reordered)).toBe(true);
    expect(sameRow(a, { ...a, content: { ...mcq, correct: 'a' } })).toBe(false);
  });

  it('lww picks the same winner whatever the nested key order (tie on updatedAt and id)', () => {
    const a = makeCard(cardFields(long));
    const b = makeCard({ ...cardFields({ ...long, marks: 5 }) });
    const bReordered = {
      ...b,
      content: Object.fromEntries(Object.entries(b.content).reverse()),
    } as typeof b;
    expect(sameRow(lww(a, b), lww(a, bReordered))).toBe(true);
    expect(sameRow(lww(b, a), lww(bReordered, a))).toBe(true);
  });

  it('mergeLog keeps a non-null outcome over a null one (an old client strips it), in either order', () => {
    const outcome = { kind: 'mcq', selected: 'b', correct: true } as const;
    const full = makeLog({ outcome, rating: 3 });
    const stripped = makeLog({ outcome: null, rating: 3 });
    expect(mergeLog(full, stripped).outcome).toEqual(outcome);
    expect(mergeLog(stripped, full).outcome).toEqual(outcome);
    expect(mergeLog(stripped, { ...full, voidedAt: T0 + 1 })).toMatchObject({
      outcome,
      voidedAt: T0 + 1,
    });
  });
});

describe('sync protocol v2', () => {
  const body = { deviceId: 'd', decks: [], cards: [], reviewLogs: [], events: [] };

  it('pushes carry protocolVersion 2', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(PushRequestSchema.safeParse({ ...body, protocolVersion: 2 }).success).toBe(true);
    expect(PushRequestSchema.safeParse(body).success).toBe(false);
    expect(PushRequestSchema.safeParse({ ...body, protocolVersion: 1 }).success).toBe(false);
  });
});

describe('backup format v2 (and v1 files still import)', () => {
  const deck = makeDeck();

  it('a version 2 backup holds cards of every type and logs with outcomes', () => {
    const card = makeCard({ ...cardFields(mcq), deckId: deck.id });
    const log = makeLog({ outcome: { kind: 'mcq', selected: 'a', correct: false }, rating: 1 });
    const backup = {
      format: 'recall-backup',
      version: 2,
      exportedAt: T0,
      decks: [deck],
      cards: [card],
      reviewLogs: [log],
    };
    expect(BackupSchema.parse(backup)).toEqual(backup);
  });

  it('a version 1 backup (pre-M6) imports as basic cards and logs without outcomes', () => {
    const v1 = {
      format: 'recall-backup',
      version: 1,
      exportedAt: T0,
      decks: [deck],
      cards: [
        {
          id: uuid(100),
          deckId: deck.id,
          front: 'Q',
          back: 'A',
          createdAt: T0,
          updatedAt: T0,
          deletedAt: null,
        },
      ],
      reviewLogs: [
        {
          id: uuid(1000),
          cardId: uuid(100),
          rating: 3,
          reviewedAt: T0,
          durationMs: 1000,
          deviceId: 'd',
          voidedAt: null,
        },
      ],
    };
    const parsed = BackupSchema.parse(v1);
    expect(parsed.version).toBe(2);
    expect(parsed.cards[0]).toEqual(makeCard({ front: 'Q', back: 'A', deckId: deck.id }));
    expect(parsed.reviewLogs[0]?.outcome).toBeNull();
  });
});

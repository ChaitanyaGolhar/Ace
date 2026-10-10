import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  CatalogDetailSchema,
  CatalogListSchema,
  EventSchema,
  sampleCards,
  summarizeDeck,
  validateDeckFile,
  type CardContent,
  type DeckFile,
} from '../src';
import { DAY, makeCard, makeDeck, T0, uuid } from './helpers/fixtures';

// M7 core pieces around the catalog (BUILD_BRIEF_M6_M8 §7.3, §7.7, §7.8): the queue's
// unit filter, the sample cards a deck page shows, the list/detail shapes, and events.

function deck(cards: [string, number, CardContent][]): DeckFile {
  const result = validateDeckFile({
    format: 'ace-deck@2',
    slug: 'sppu-te-cse-dbms',
    version: 2,
    title: 'Database Management Systems',
    description: 'Unit-wise revision.',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE', 'CSE-DS'],
      subject: 'DBMS',
      subjectCodes: { CSE: 'PCC301COM', 'CSE-DS': null },
      units: [
        { number: 1, title: 'Intro' },
        { number: 2, title: 'Relational' },
        { number: 10, title: 'Advanced' },
      ],
    },
    price: 4900,
    author: 'Chaitanya Golhar',
    lastVerifiedAt: '2026-10-11',
    cards: cards.map(([key, unit, content]) => ({ key, unit, ...content })),
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.deck;
}

const b = (front: string): CardContent => ({ type: 'basic', front, back: `${front}!` });
const mcq: CardContent = {
  type: 'mcq',
  question: 'Pick',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correct: 'a',
  explanation: null,
};
const cloze: CardContent = {
  type: 'cloze',
  text: 'A {{key}}.',
  accepted: [],
  hint: null,
  extra: null,
};
const short: CardContent = {
  type: 'short',
  question: 'Why?',
  answer: 'Because.',
  explanation: null,
};
const long: CardContent = {
  type: 'long',
  question: 'Explain.',
  marks: 6,
  keyPoints: ['a', 'b', 'c'],
  modelAnswer: null,
};

describe('buildQueue: unit filter (§7.7)', () => {
  const DECK = makeDeck({ id: uuid(1) });
  const cards = [
    makeCard({ id: uuid(10), deckId: DECK.id, unit: 1, createdAt: T0 - DAY }),
    makeCard({ id: uuid(11), deckId: DECK.id, unit: 2, createdAt: T0 - DAY + 1 }),
    makeCard({ id: uuid(12), deckId: DECK.id, unit: null, createdAt: T0 - DAY + 2 }),
  ];
  const input = {
    decks: [DECK],
    cards,
    states: new Map(),
    logs: [],
    now: T0,
    timeZone: 'Asia/Kolkata',
    rolloverHour: 4,
    newPerDay: 20,
    deckId: DECK.id,
  };

  it('without a unit: every card of the deck', () => {
    expect(buildQueue(input).newCards).toEqual([uuid(10), uuid(11), uuid(12)]);
  });

  it('with a unit: only that unit’s cards', () => {
    expect(buildQueue({ ...input, unit: 2 }).newCards).toEqual([uuid(11)]);
    expect(buildQueue({ ...input, unit: 7 }).newCards).toEqual([]);
  });
});

describe('sampleCards (§7.3): 8 cards, the first of each type, then key order', () => {
  it('takes the first card of each type, then fills up in key order (u2 before u10)', () => {
    const d = deck([
      ['u10-001', 10, b('ten')],
      ['u1-002', 1, mcq],
      ['u1-001', 1, b('one')],
      ['u2-001', 2, cloze],
      ['u2-002', 2, short],
      ['u2-003', 2, long],
      ['u1-003', 1, b('three')],
      ['u1-004', 1, b('four')],
      ['u1-005', 1, b('five')],
      ['u2-004', 2, b('u2 four')],
    ]);
    // First of each type in file order: basic u10-001, mcq u1-002, cloze u2-001,
    // short u2-002, long u2-003. Then key order fills 3 more: u1-001, u1-003, u1-004.
    expect(sampleCards(d).map((c) => c.key)).toEqual([
      'u1-001',
      'u1-002',
      'u1-003',
      'u1-004',
      'u2-001',
      'u2-002',
      'u2-003',
      'u10-001',
    ]);
  });

  it('a small deck shows all its cards', () => {
    expect(sampleCards(deck([['u1-001', 1, b('only')]]))).toHaveLength(1);
  });
});

describe('summarizeDeck: what the store lists (no card content)', () => {
  const d = deck([
    ['u1-001', 1, b('one')],
    ['u1-002', 1, mcq],
    ['u2-001', 2, long],
  ]);

  it('metadata, card count, type counts and unit counts', () => {
    const s = summarizeDeck(d);
    expect(s).toMatchObject({
      slug: 'sppu-te-cse-dbms',
      version: 2,
      title: 'Database Management Systems',
      price: 4900,
      lastVerifiedAt: '2026-10-11',
      cardCount: 3,
      typeCounts: { basic: 1, mcq: 1, cloze: 0, short: 0, long: 1 },
      units: [
        { number: 1, title: 'Intro', cardCount: 2 },
        { number: 2, title: 'Relational', cardCount: 1 },
        { number: 10, title: 'Advanced', cardCount: 0 },
      ],
    });
    expect(JSON.stringify(s)).not.toContain('one!'); // no card text
  });

  it('list and detail responses validate', () => {
    expect(CatalogListSchema.parse({ decks: [summarizeDeck(d)] }).decks).toHaveLength(1);
    expect(
      CatalogDetailSchema.parse({ deck: summarizeDeck(d), samples: sampleCards(d) }).samples,
    ).toHaveLength(3);
  });
});

describe('M7 events (§7.8): slugs and numbers only', () => {
  const base = { id: uuid(1), occurredAt: T0, deviceId: 'd' };
  it('accepts the four store events', () => {
    for (const e of [
      { type: 'store_opened', props: {} },
      { type: 'catalog_deck_viewed', props: { slug: 'sppu-te-cse-dbms' } },
      { type: 'catalog_deck_added', props: { slug: 'sppu-te-cse-dbms', version: 2 } },
      { type: 'deck_update_applied', props: { slug: 'sppu-te-cse-dbms', from: 1, to: 3 } },
    ]) {
      expect(EventSchema.safeParse({ ...base, ...e }).success, e.type).toBe(true);
    }
  });

  it('rejects anything that could carry card text', () => {
    expect(
      EventSchema.safeParse({
        ...base,
        type: 'catalog_deck_viewed',
        props: { slug: 'Has spaces?' },
      }).success,
    ).toBe(false);
    expect(
      EventSchema.safeParse({
        ...base,
        type: 'catalog_deck_added',
        props: { slug: 'x', version: 1, title: 'DBMS' },
      }).success,
    ).toBe(false);
  });
});

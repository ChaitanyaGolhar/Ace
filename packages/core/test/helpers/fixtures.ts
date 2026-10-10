import type { Card, Deck, ReviewLog } from '../../src';

/**
 * Deterministic, valid UUID v7 strings. Lexical order follows `n`, which makes
 * id-based tie-breaks easy to reason about in tests.
 */
export function uuid(n: number): string {
  return `01920000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** A fixed instant used as "now" in tests: 2026-10-10T10:00:00Z. */
export const T0 = Date.UTC(2026, 9, 10, 10, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: uuid(1),
    name: 'Deck',
    source: 'user',
    prebuiltId: null,
    catalogSlug: null,
    catalogVersion: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * A valid card. Without `content`, it's a basic card built from `front`/`back` (so a
 * test that overrides only the text gets a consistent card, as before M6).
 */
export function makeCard(overrides: Partial<Card> = {}): Card {
  const front = overrides.front ?? 'front';
  const back = overrides.back ?? 'back';
  return {
    id: uuid(100),
    deckId: uuid(1),
    type: 'basic',
    content: { type: 'basic', front, back },
    front,
    back,
    unit: null,
    sourceKey: null,
    sourceHash: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

export function makeLog(overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: uuid(1000),
    cardId: uuid(100),
    rating: 3,
    reviewedAt: T0,
    durationMs: 5000,
    deviceId: 'device-a',
    voidedAt: null,
    outcome: null,
    ...overrides,
  };
}

import { cardFields, type AppEvent, type Card, type Deck, type ReviewLog } from '@recall/core';
import request from 'supertest';
import { T0, type TestApp } from './helpers';

let counter = 0;

/** Fresh, valid, increasing UUID v7 strings. */
export function uuid(): string {
  counter += 1;
  return `01920000-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`;
}

export function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: uuid(),
    name: 'Deck',
    source: 'user',
    prebuiltId: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

/** A basic card built from front/back unless `content` is given (as before M6). */
export function card(deckId: string, overrides: Partial<Card> = {}): Card {
  return {
    id: uuid(),
    deckId,
    ...cardFields({
      type: 'basic',
      front: overrides.front ?? 'front',
      back: overrides.back ?? 'back',
    }),
    unit: null,
    sourceKey: null,
    sourceHash: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides,
  };
}

export function log(cardId: string, overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: uuid(),
    cardId,
    rating: 3,
    reviewedAt: T0,
    durationMs: 1000,
    deviceId: 'device-a',
    voidedAt: null,
    outcome: null,
    ...overrides,
  };
}

export function event(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: uuid(),
    type: 'app_opened',
    props: {},
    occurredAt: T0,
    deviceId: 'device-a',
    ...overrides,
  } as AppEvent;
}

export interface Batch {
  decks?: Deck[];
  cards?: Card[];
  reviewLogs?: ReviewLog[];
  events?: AppEvent[];
}

export function push(t: TestApp, cookie: string, batch: Batch) {
  return request(t.app)
    .post('/sync/push')
    .set('Cookie', cookie)
    .send({
      protocolVersion: 2,
      deviceId: 'device-a',
      decks: batch.decks ?? [],
      cards: batch.cards ?? [],
      reviewLogs: batch.reviewLogs ?? [],
      events: batch.events ?? [],
    });
}

export function pull(t: TestApp, cookie: string, since = '0', limit?: number) {
  return request(t.app)
    .get('/sync/pull')
    .query({ since, ...(limit === undefined ? {} : { limit }) })
    .set('Cookie', cookie);
}

/** Every synced row in the database, for exact before/after comparisons. */
export async function dump(t: TestApp) {
  const [decks, cards, logs, events] = await Promise.all([
    t.prisma.$queryRawUnsafe('SELECT * FROM decks ORDER BY id'),
    t.prisma.$queryRawUnsafe('SELECT * FROM cards ORDER BY id'),
    t.prisma.$queryRawUnsafe('SELECT * FROM review_logs ORDER BY id'),
    t.prisma.$queryRawUnsafe('SELECT * FROM events ORDER BY id'),
  ]);
  return { decks, cards, logs, events };
}

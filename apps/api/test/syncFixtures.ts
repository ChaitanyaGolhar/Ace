import type { Card, Deck, ReviewLog } from '@recall/core';
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

export function card(deckId: string, overrides: Partial<Card> = {}): Card {
  return {
    id: uuid(),
    deckId,
    front: 'front',
    back: 'back',
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
    ...overrides,
  };
}

export interface Batch {
  decks?: Deck[];
  cards?: Card[];
  reviewLogs?: ReviewLog[];
}

export function push(t: TestApp, cookie: string, batch: Batch) {
  return request(t.app)
    .post('/sync/push')
    .set('Cookie', cookie)
    .send({
      deviceId: 'device-a',
      decks: batch.decks ?? [],
      cards: batch.cards ?? [],
      reviewLogs: batch.reviewLogs ?? [],
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
  const [decks, cards, logs] = await Promise.all([
    t.prisma.$queryRawUnsafe('SELECT * FROM decks ORDER BY id'),
    t.prisma.$queryRawUnsafe('SELECT * FROM cards ORDER BY id'),
    t.prisma.$queryRawUnsafe('SELECT * FROM review_logs ORDER BY id'),
  ]);
  return { decks, cards, logs };
}

import Dexie, { type EntityTable } from 'dexie';
import type { AppEvent, Card, CardState, Deck, ReviewLog } from '@recall/core';

/**
 * Local-only bookkeeping on every synced row. Never sent to the server.
 * - `dirty`: 1 = changed locally and not yet pushed.
 * - `localVersion`: incremented on every local edit. The sync engine (M2) only
 *   clears `dirty` if this hasn't changed while a push was in flight.
 */
export interface SyncFields {
  dirty: 0 | 1;
  localVersion: number;
}

export type LocalDeck = Deck & SyncFields;
export type LocalCard = Card & SyncFields;
export type LocalReviewLog = ReviewLog & SyncFields;
export type LocalEvent = AppEvent & SyncFields;

export interface MetaRow {
  key: string;
  value: unknown;
}

export class RecallDB extends Dexie {
  decks!: EntityTable<LocalDeck, 'id'>;
  cards!: EntityTable<LocalCard, 'id'>;
  reviewLogs!: EntityTable<LocalReviewLog, 'id'>;
  cardStates!: EntityTable<CardState, 'cardId'>;
  meta!: EntityTable<MetaRow, 'key'>;
  events!: EntityTable<LocalEvent, 'id'>;

  constructor(name = 'recall') {
    super(name);
    this.version(1).stores({
      decks: 'id, updatedAt, deletedAt, dirty',
      cards: 'id, deckId, updatedAt, deletedAt, dirty',
      reviewLogs: 'id, cardId, reviewedAt, dirty',
      cardStates: 'cardId, due, state',
      meta: 'key', // deviceId, syncCursor, schedulerVersion, settings, session, ...
    });
    // M4: product events, append-only and synced like review logs.
    this.version(2).stores({
      events: 'id, type, occurredAt, dirty',
    });
  }
}

/** Strips the local-only fields, e.g. before exporting or pushing a row. */
export function withoutSyncFields<T extends SyncFields>(row: T): Omit<T, keyof SyncFields> {
  const { dirty: _dirty, localVersion: _localVersion, ...rest } = row;
  return rest;
}

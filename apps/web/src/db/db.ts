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
    // M6: typed cards and review outcomes (BUILD_BRIEF_M6_M8 §6.2). Existing cards become
    // basic cards with the same text; logs get `outcome: null`. Schedules and history are
    // untouched. The sync cursor goes back to 0, so this device pulls everything once
    // more: an old version of the app stripped `type`/`content` from rows it pulled, and
    // those rows wouldn't otherwise be sent again.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('cards')
          .toCollection()
          .modify((card: Record<string, unknown>) => {
            if (card.content !== undefined) return;
            card.type = 'basic';
            card.content = { type: 'basic', front: card.front, back: card.back };
            card.unit = null;
            card.sourceKey = null;
            card.sourceHash = null;
          });
        await tx
          .table('reviewLogs')
          .toCollection()
          .modify((log: Record<string, unknown>) => {
            if (log.outcome === undefined) log.outcome = null;
          });
        await tx.table('meta').put({ key: 'syncCursor', value: '0' });
      });
    // M7: decks remember the catalog deck they came from (BUILD_BRIEF_M6_M8 §7.5). Every
    // existing deck is a user or ready-made deck: no catalog fields. One more re-pull, as
    // in v3, in case an M6 copy of the app stripped those fields from rows it pulled.
    this.version(4)
      .stores({ decks: 'id, updatedAt, deletedAt, dirty, catalogSlug' })
      .upgrade(async (tx) => {
        await tx
          .table('decks')
          .toCollection()
          .modify((deck: Record<string, unknown>) => {
            if (deck.catalogSlug === undefined) deck.catalogSlug = null;
            if (deck.catalogVersion === undefined) deck.catalogVersion = null;
          });
        await tx.table('meta').put({ key: 'syncCursor', value: '0' });
      });
  }
}

/** Strips the local-only fields, e.g. before exporting or pushing a row. */
export function withoutSyncFields<T extends SyncFields>(row: T): Omit<T, keyof SyncFields> {
  const { dirty: _dirty, localVersion: _localVersion, ...rest } = row;
  return rest;
}

import type { Card, Deck, ReviewLog } from '@recall/core';

// Raw rows as Postgres returns them (BIGINT → bigint), and conversion to the domain
// shape (epoch-ms numbers). Every synced timestamp is a safe integer, so Number() is exact.

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  source: string;
  prebuilt_id: string | null;
  created_at: bigint;
  updated_at: bigint;
  deleted_at: bigint | null;
  server_seq: bigint;
}

export interface CardRow {
  id: string;
  user_id: string;
  deck_id: string;
  front: string;
  back: string;
  created_at: bigint;
  updated_at: bigint;
  deleted_at: bigint | null;
  server_seq: bigint;
}

export interface LogRow {
  id: string;
  user_id: string;
  card_id: string;
  rating: number;
  reviewed_at: bigint;
  duration_ms: number;
  device_id: string;
  voided_at: bigint | null;
  server_seq: bigint;
}

const num = (v: bigint) => Number(v);
const numOrNull = (v: bigint | null) => (v === null ? null : Number(v));

export function toDeck(r: DeckRow): Deck {
  return {
    id: r.id,
    name: r.name,
    source: r.source as Deck['source'], // only ever written from a validated Deck
    prebuiltId: r.prebuilt_id,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    deletedAt: numOrNull(r.deleted_at),
  };
}

export function toCard(r: CardRow): Card {
  return {
    id: r.id,
    deckId: r.deck_id,
    front: r.front,
    back: r.back,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    deletedAt: numOrNull(r.deleted_at),
  };
}

export function toLog(r: LogRow): ReviewLog {
  return {
    id: r.id,
    cardId: r.card_id,
    rating: r.rating as ReviewLog['rating'], // only ever written from a validated log
    reviewedAt: num(r.reviewed_at),
    durationMs: r.duration_ms,
    deviceId: r.device_id,
    voidedAt: numOrNull(r.voided_at),
  };
}

/** Key-order-independent equality of two flat domain rows. */
export function sameRow(a: object, b: object): boolean {
  const canonical = (row: object) =>
    JSON.stringify(Object.entries(row).sort(([x], [y]) => (x < y ? -1 : 1)));
  return canonical(a) === canonical(b);
}

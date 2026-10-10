import {
  cardFields,
  CardContentSchema,
  EventSchema,
  OutcomeSchema,
  type AppEvent,
  type Card,
  type Deck,
  type ReviewLog,
} from '@recall/core';

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
  type: string;
  content: unknown;
  unit: number | null;
  source_key: string | null;
  source_hash: string | null;
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
  outcome: unknown;
  server_seq: bigint;
}

export interface EventRow {
  id: string;
  user_id: string;
  type: string;
  occurred_at: bigint;
  device_id: string;
  props: unknown;
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

/**
 * A card row → domain card (M6). A basic card's text is its front/back columns (also
 * when `content` is NULL, written by pre-M6 code during a rollback). A typed card's
 * `content` is the source of truth and front/back are re-derived from it, so what the
 * API returns is always consistent.
 */
export function toCard(r: CardRow): Card {
  const content =
    r.content === null || r.type === 'basic'
      ? { type: 'basic' as const, front: r.front, back: r.back }
      : CardContentSchema.parse(r.content); // only ever written from validated content
  return {
    id: r.id,
    deckId: r.deck_id,
    ...cardFields(content),
    unit: r.unit,
    sourceKey: r.source_key,
    sourceHash: r.source_hash,
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
    outcome: r.outcome === null ? null : OutcomeSchema.parse(r.outcome),
  };
}

export function toEvent(r: EventRow): AppEvent {
  // Stored only from validated events; parsing again restores the precise union type.
  return EventSchema.parse({
    id: r.id,
    type: r.type,
    props: r.props,
    occurredAt: num(r.occurred_at),
    deviceId: r.device_id,
  });
}

import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  MAX_PUSH_ROWS,
  PullQuerySchema,
  PullResponseSchema,
  PushRequestSchema,
  PushResponseSchema,
} from '../src';
import { makeCard, makeDeck, makeLog, uuid } from './helpers/fixtures';

describe('PushRequestSchema', () => {
  it('accepts a batch of decks, cards and logs', () => {
    const body = {
      protocolVersion: PROTOCOL_VERSION,
      deviceId: 'device-a',
      decks: [makeDeck()],
      cards: [makeCard()],
      reviewLogs: [makeLog()],
    };
    expect(PushRequestSchema.parse(body)).toEqual({ ...body, events: [] });
  });

  it('allows at most 500 rows in total', () => {
    const logs = (n: number) => Array.from({ length: n }, (_, i) => makeLog({ id: uuid(i + 1) }));
    const at = (n: number) => ({
      protocolVersion: PROTOCOL_VERSION,
      deviceId: 'd',
      decks: [makeDeck()],
      cards: [],
      reviewLogs: logs(n),
    });
    expect(MAX_PUSH_ROWS).toBe(500);
    expect(PushRequestSchema.safeParse(at(499)).success).toBe(true);
    expect(PushRequestSchema.safeParse(at(500)).success).toBe(false);
  });

  it('rejects an invalid row anywhere in the batch', () => {
    const body = {
      protocolVersion: PROTOCOL_VERSION,
      deviceId: 'd',
      decks: [],
      cards: [makeCard({ front: '' })],
      reviewLogs: [],
    };
    expect(PushRequestSchema.safeParse(body).success).toBe(false);
  });

  it('never accepts a userId from the client (unknown keys are stripped)', () => {
    const parsed = PushRequestSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      deviceId: 'd',
      userId: 'someone-else',
      decks: [{ ...makeDeck(), userId: 'someone-else' }],
      cards: [],
      reviewLogs: [],
    });
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed.decks[0]).not.toHaveProperty('userId');
  });
});

describe('PushResponseSchema', () => {
  it('lists the accepted ids per table', () => {
    const body = { accepted: { decks: [uuid(1)], cards: [], reviewLogs: [uuid(2)] } };
    expect(PushResponseSchema.parse(body)).toEqual({ accepted: { ...body.accepted, events: [] } });
  });
});

describe('PullQuerySchema', () => {
  it('defaults to since=0 and limit=500', () => {
    expect(PullQuerySchema.parse({ protocolVersion: '3' })).toEqual({
      since: '0',
      limit: 500,
      protocolVersion: 3,
    });
  });

  it('parses query-string values', () => {
    expect(PullQuerySchema.parse({ since: '12345', limit: '20', protocolVersion: '3' })).toEqual({
      since: '12345',
      limit: 20,
      protocolVersion: 3,
    });
  });

  it('rejects a non-numeric cursor and limits outside 1–500', () => {
    expect(PullQuerySchema.safeParse({ since: 'abc', protocolVersion: '3' }).success).toBe(false);
    expect(PullQuerySchema.safeParse({ since: '-1' }).success).toBe(false);
    expect(PullQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(PullQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
  });
});

describe('PullResponseSchema', () => {
  it('has rows per table, a string cursor and hasMore', () => {
    const body = {
      decks: [makeDeck()],
      cards: [makeCard()],
      reviewLogs: [makeLog()],
      nextCursor: '42',
      hasMore: false,
    };
    expect(PullResponseSchema.parse(body)).toEqual({ ...body, events: [] });
  });
});

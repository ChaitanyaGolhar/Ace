import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EVENT_PROPS,
  EVENT_TYPES,
  EventSchema,
  PullResponseSchema,
  PushRequestSchema,
} from '../src';
import { uuid } from './helpers/fixtures';

const base = { id: uuid(1), occurredAt: 1_760_000_000_000, deviceId: 'device-a' };

describe('EventSchema', () => {
  it('has exactly the brief’s event types', () => {
    expect([...EVENT_TYPES].sort()).toEqual(
      [
        'app_opened',
        'card_created',
        'deck_added_prebuilt',
        'first_review_completed',
        'session_abandoned',
        'session_completed',
        'session_started',
        'signed_in',
      ].sort(),
    );
  });

  it('accepts a valid event of each type', () => {
    const samples = [
      { type: 'app_opened', props: {} },
      { type: 'first_review_completed', props: {} },
      { type: 'session_started', props: { scope: 'all', due: 3, new: 5 } },
      { type: 'session_completed', props: { reviewed: 8, durationMs: 120_000 } },
      { type: 'session_abandoned', props: { reviewed: 2, remaining: 6 } },
      { type: 'deck_added_prebuilt', props: { prebuiltId: 'dbms-basics-v1' } },
      { type: 'card_created', props: {} },
      { type: 'signed_in', props: {} },
    ];
    for (const sample of samples) {
      expect(EventSchema.safeParse({ ...base, ...sample }).success, sample.type).toBe(true);
    }
  });

  it('rejects unknown types and malformed fields', () => {
    expect(EventSchema.safeParse({ ...base, type: 'nope', props: {} }).success).toBe(false);
    expect(EventSchema.safeParse({ ...base, id: 'x', type: 'app_opened', props: {} }).success).toBe(
      false,
    );
    expect(
      EventSchema.safeParse({
        ...base,
        type: 'session_completed',
        props: { reviewed: -1, durationMs: 0 },
      }).success,
    ).toBe(false);
  });

  it('no event payload can contain card text (front/back): props are strict', () => {
    for (const type of EVENT_TYPES) {
      const withText = { ...base, type, props: { front: 'What is ACID?', back: 'Atomicity…' } };
      expect(EventSchema.safeParse(withText).success, type).toBe(false);
    }
  });

  it('no payload field is free text: every prop is a number, boolean, enum or slug', () => {
    for (const type of EVENT_TYPES) {
      const shape = EVENT_PROPS[type].shape as Record<string, z.ZodType>;
      for (const [key, schema] of Object.entries(shape)) {
        const allowed =
          schema instanceof z.ZodNumber ||
          schema instanceof z.ZodBoolean ||
          schema instanceof z.ZodEnum ||
          // The only string: a deck slug (pattern-restricted, so no sentence fits).
          (key === 'prebuiltId' && schema instanceof z.ZodString);
        expect(allowed, `${type}.${key}`).toBe(true);
      }
    }
    expect(
      EventSchema.safeParse({
        ...base,
        type: 'deck_added_prebuilt',
        props: { prebuiltId: 'What does ACID stand for?' },
      }).success,
    ).toBe(false);
  });
});

describe('events in the sync protocol', () => {
  const event = { ...base, type: 'app_opened' as const, props: {} };

  it('push and pull carry events (defaulting to none)', () => {
    const push = PushRequestSchema.parse({
      protocolVersion: 2,
      deviceId: 'd',
      decks: [],
      cards: [],
      reviewLogs: [],
    });
    expect(push.events).toEqual([]);
    expect(
      PushRequestSchema.parse({
        protocolVersion: 2,
        deviceId: 'd',
        decks: [],
        cards: [],
        reviewLogs: [],
        events: [event],
      }).events,
    ).toEqual([event]);
    const pull = PullResponseSchema.parse({
      decks: [],
      cards: [],
      reviewLogs: [],
      events: [event],
      nextCursor: '1',
      hasMore: false,
    });
    expect(pull.events).toEqual([event]);
  });

  it('events count towards the 500-row push limit', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ ...event, id: uuid(i + 10) }));
    expect(
      PushRequestSchema.safeParse({
        protocolVersion: 2,
        deviceId: 'd',
        decks: [],
        cards: [],
        reviewLogs: [],
        events,
      }).success,
    ).toBe(false);
  });
});

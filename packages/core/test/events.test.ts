import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EVENT_PROPS,
  EVENTS_VERSION,
  eventTypesFor,
  PROTOCOL_VERSION,
  PullQuerySchema,
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
        // M7 (BUILD_BRIEF_M6_M8 §7.8)
        'store_opened',
        'catalog_deck_viewed',
        'catalog_deck_added',
        'deck_update_applied',
        // M8 (§8.5)
        'purchase_info_viewed',
        'code_redeemed',
        'code_redeem_failed',
        // Feel pass: coming back after a break
        'break_return_shown',
        'capped_session_started',
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
      { type: 'break_return_shown', props: { due: 45, daysAway: 4 } },
      { type: 'capped_session_started', props: { cap: 20, due: 45 } },
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
          // The only strings: deck slugs (pattern-restricted, so no sentence fits).
          ((key === 'prebuiltId' || key === 'slug') && schema instanceof z.ZodString) ||
          // M8: a list of deck slugs (each pattern-restricted).
          (key === 'slugs' &&
            schema instanceof z.ZodArray &&
            (schema as z.ZodArray<z.ZodType>).element instanceof z.ZodString);
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
    expect(
      EventSchema.safeParse({
        ...base,
        type: 'catalog_deck_viewed',
        props: { slug: 'What does ACID stand for?' },
      }).success,
    ).toBe(false);
  });
});

describe('events in the sync protocol', () => {
  const event = { ...base, type: 'app_opened' as const, props: {} };

  it('push and pull carry events (defaulting to none)', () => {
    const push = PushRequestSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      deviceId: 'd',
      decks: [],
      cards: [],
      reviewLogs: [],
    });
    expect(push.events).toEqual([]);
    expect(
      PushRequestSchema.parse({
        protocolVersion: PROTOCOL_VERSION,
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
        protocolVersion: PROTOCOL_VERSION,
        deviceId: 'd',
        decks: [],
        cards: [],
        reviewLogs: [],
        events,
      }).success,
    ).toBe(false);
  });
});

describe('event catalogue versions (old apps never pull a type they can’t parse)', () => {
  const M8_TYPES = [
    'app_opened',
    'first_review_completed',
    'session_started',
    'session_completed',
    'session_abandoned',
    'deck_added_prebuilt',
    'card_created',
    'signed_in',
    'store_opened',
    'catalog_deck_viewed',
    'catalog_deck_added',
    'deck_update_applied',
    'purchase_info_viewed',
    'code_redeemed',
    'code_redeem_failed',
  ];

  it('version 1 is exactly what M8 apps know; version 2 adds the break-return events', () => {
    expect(EVENTS_VERSION).toBe(2);
    expect([...eventTypesFor(1)].sort()).toEqual([...M8_TYPES].sort());
    expect([...eventTypesFor(2)].sort()).toEqual([...EVENT_TYPES].sort());
    // A newer app than this server gets everything the server has.
    expect([...eventTypesFor(7)].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('pulls may declare the version they understand; none means 1', () => {
    const q = { since: '0', protocolVersion: String(PROTOCOL_VERSION) };
    expect(PullQuerySchema.parse(q).eventsVersion).toBe(1);
    expect(PullQuerySchema.parse({ ...q, eventsVersion: '2' }).eventsVersion).toBe(2);
    expect(PullQuerySchema.safeParse({ ...q, eventsVersion: '0' }).success).toBe(false);
    expect(PullQuerySchema.safeParse({ ...q, eventsVersion: 'x' }).success).toBe(false);
  });
});

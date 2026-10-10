import { describe, expect, it } from 'vitest';
import {
  CardSchema,
  DeckSchema,
  MAX_CARD_TEXT_LENGTH,
  MAX_DECK_NAME_LENGTH,
  ReviewLogSchema,
} from '../src';
import { makeCard, makeDeck, makeLog, T0 } from './helpers/fixtures';

describe('DeckSchema', () => {
  it('accepts a valid user deck', () => {
    expect(DeckSchema.parse(makeDeck())).toEqual(makeDeck());
  });

  it('accepts a prebuilt deck with a prebuiltId and a tombstone', () => {
    const deck = makeDeck({ source: 'prebuilt', prebuiltId: 'dbms-basics-v1', deletedAt: T0 });
    expect(DeckSchema.safeParse(deck).success).toBe(true);
  });

  it('requires prebuiltId exactly when source is prebuilt', () => {
    expect(DeckSchema.safeParse(makeDeck({ source: 'prebuilt', prebuiltId: null })).success).toBe(
      false,
    );
    expect(DeckSchema.safeParse(makeDeck({ source: 'user', prebuiltId: 'x' })).success).toBe(false);
  });

  it('rejects ids that are not UUID v7', () => {
    const v4 = '550e8400-e29b-41d4-a716-446655440000';
    expect(DeckSchema.safeParse(makeDeck({ id: v4 })).success).toBe(false);
  });

  it('rejects an empty name and unknown source', () => {
    expect(DeckSchema.safeParse(makeDeck({ name: '' })).success).toBe(false);
    expect(DeckSchema.safeParse({ ...makeDeck(), source: 'ai' }).success).toBe(false);
  });

  it('rejects timestamps that are not non-negative integer epoch ms', () => {
    expect(DeckSchema.safeParse(makeDeck({ createdAt: -1 })).success).toBe(false);
    expect(DeckSchema.safeParse(makeDeck({ updatedAt: 1.5 })).success).toBe(false);
    expect(DeckSchema.safeParse({ ...makeDeck(), deletedAt: '2026-10-10' }).success).toBe(false);
  });

  it('strips local-only fields such as dirty and localVersion', () => {
    const parsed = DeckSchema.parse({ ...makeDeck(), dirty: 1, localVersion: 3 });
    expect(parsed).toEqual(makeDeck());
  });
});

describe('CardSchema', () => {
  it('accepts a valid card and preserves line breaks', () => {
    const card = makeCard({ front: 'line 1\nline 2', back: 'a\r\n\nb' });
    expect(CardSchema.parse(card)).toEqual(card);
  });

  it('rejects an empty front or back', () => {
    expect(CardSchema.safeParse(makeCard({ front: '' })).success).toBe(false);
    expect(CardSchema.safeParse(makeCard({ back: '' })).success).toBe(false);
  });

  it('rejects a non-v7 deckId', () => {
    expect(CardSchema.safeParse(makeCard({ deckId: 'not-a-uuid' })).success).toBe(false);
  });
});

describe('ReviewLogSchema', () => {
  it('accepts a valid log, voided or not', () => {
    expect(ReviewLogSchema.parse(makeLog())).toEqual(makeLog());
    expect(ReviewLogSchema.safeParse(makeLog({ voidedAt: T0 + 1 })).success).toBe(true);
  });

  it('only accepts ratings 1 to 4', () => {
    for (const rating of [1, 2, 3, 4]) {
      expect(ReviewLogSchema.safeParse({ ...makeLog(), rating }).success).toBe(true);
    }
    for (const rating of [0, 5, 2.5, '3']) {
      expect(ReviewLogSchema.safeParse({ ...makeLog(), rating }).success).toBe(false);
    }
  });

  it('rejects a negative duration and an empty deviceId', () => {
    expect(ReviewLogSchema.safeParse(makeLog({ durationMs: -1 })).success).toBe(false);
    expect(ReviewLogSchema.safeParse(makeLog({ deviceId: '' })).success).toBe(false);
  });
});

describe('max lengths (shared by client and server)', () => {
  it('deck name: 200 characters allowed, 201 rejected', () => {
    expect(DeckSchema.safeParse(makeDeck({ name: 'x'.repeat(200) })).success).toBe(true);
    expect(DeckSchema.safeParse(makeDeck({ name: 'x'.repeat(201) })).success).toBe(false);
  });

  it('card front and back: 20,000 characters allowed, 20,001 rejected', () => {
    const ok = 'y'.repeat(20_000);
    const tooLong = 'y'.repeat(20_001);
    expect(CardSchema.safeParse(makeCard({ front: ok, back: ok })).success).toBe(true);
    expect(CardSchema.safeParse(makeCard({ front: tooLong })).success).toBe(false);
    expect(CardSchema.safeParse(makeCard({ back: tooLong })).success).toBe(false);
  });

  it('exports the limits for UIs', () => {
    expect(MAX_DECK_NAME_LENGTH).toBe(200);
    expect(MAX_CARD_TEXT_LENGTH).toBe(20_000);
  });
});

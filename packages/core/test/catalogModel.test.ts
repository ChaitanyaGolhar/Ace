import { describe, expect, it } from 'vitest';
import {
  BackupSchema,
  CardSchema,
  catalogCardId,
  DeckSchema,
  PROTOCOL_VERSION,
  PullQuerySchema,
  PushRequestSchema,
  PushResponseSchema,
  ReviewLogSchema,
} from '../src';
import { makeCard, makeLog } from './helpers/fixtures';

// M7 data model (BUILD_BRIEF_M6_M8 §7.5): catalog decks remember where they came from,
// catalog cards have deterministic v5 ids, and the sync protocol moves to version 3.

const T = 1_791_000_000_000;
const DECK_ID = '01920000-0000-7000-8000-0000000000aa';
const userDeck = {
  id: DECK_ID,
  name: 'Mine',
  source: 'user' as const,
  prebuiltId: null,
  createdAt: T,
  updatedAt: T,
  deletedAt: null,
};
const catalogDeck = {
  ...userDeck,
  name: 'Database Management Systems',
  source: 'catalog' as const,
  catalogSlug: 'sppu-te-cse-dbms',
  catalogVersion: 3,
};

describe('DeckSchema (M7)', () => {
  it('accepts a catalog deck with its slug and version', () => {
    expect(DeckSchema.parse(catalogDeck)).toMatchObject({
      source: 'catalog',
      catalogSlug: 'sppu-te-cse-dbms',
      catalogVersion: 3,
    });
  });

  it('pre-M7 decks get catalogSlug and catalogVersion = null', () => {
    expect(DeckSchema.parse(userDeck)).toMatchObject({ catalogSlug: null, catalogVersion: null });
    const prebuilt = { ...userDeck, source: 'prebuilt' as const, prebuiltId: 'dbms-basics-v1' };
    expect(DeckSchema.parse(prebuilt)).toMatchObject({ catalogSlug: null, catalogVersion: null });
  });

  it('a catalog deck needs both; other decks may have neither', () => {
    expect(DeckSchema.safeParse({ ...catalogDeck, catalogSlug: null }).success).toBe(false);
    expect(DeckSchema.safeParse({ ...catalogDeck, catalogVersion: null }).success).toBe(false);
    expect(DeckSchema.safeParse({ ...userDeck, catalogSlug: 'x', catalogVersion: 1 }).success).toBe(
      false,
    );
    expect(DeckSchema.safeParse({ ...catalogDeck, prebuiltId: 'dbms-basics-v1' }).success).toBe(
      false,
    );
  });

  it('slug and version are validated', () => {
    expect(DeckSchema.safeParse({ ...catalogDeck, catalogSlug: 'Bad Slug' }).success).toBe(false);
    expect(DeckSchema.safeParse({ ...catalogDeck, catalogVersion: 0 }).success).toBe(false);
    expect(DeckSchema.safeParse({ ...catalogDeck, catalogVersion: 1.5 }).success).toBe(false);
  });
});

describe('catalog card ids', () => {
  const id = catalogCardId(DECK_ID, 'u1-001');

  it('cards, review logs and push responses accept the v5 id of a catalog card', () => {
    expect(CardSchema.safeParse({ ...makeCard({ deckId: DECK_ID }), id }).success).toBe(true);
    expect(ReviewLogSchema.safeParse({ ...makeLog({}), cardId: id }).success).toBe(true);
    expect(
      PushResponseSchema.safeParse({
        accepted: { decks: [], cards: [id], reviewLogs: [], events: [] },
      }).success,
    ).toBe(true);
  });

  it('a backup with a catalog deck and its cards round-trips', () => {
    const backup = {
      format: 'recall-backup',
      version: 2,
      exportedAt: T,
      decks: [catalogDeck],
      cards: [{ ...makeCard({ deckId: DECK_ID }), id }],
      reviewLogs: [{ ...makeLog({}), cardId: id }],
    };
    const parsed = BackupSchema.parse(backup);
    expect(parsed.decks[0]).toMatchObject({ catalogSlug: 'sppu-te-cse-dbms', catalogVersion: 3 });
    expect(parsed.cards[0]?.id).toBe(id);
  });
});

describe('protocol version 3', () => {
  it('pushes must say 3; 2 is refused', () => {
    expect(PROTOCOL_VERSION).toBe(3);
    const body = { deviceId: 'd', decks: [catalogDeck], cards: [], reviewLogs: [], events: [] };
    expect(PushRequestSchema.safeParse({ ...body, protocolVersion: 3 }).success).toBe(true);
    expect(PushRequestSchema.safeParse({ ...body, protocolVersion: 2 }).success).toBe(false);
  });

  it('pulls carry the protocol version too (an old app can’t parse catalog rows)', () => {
    expect(PullQuerySchema.parse({ since: '5', protocolVersion: '3' })).toMatchObject({
      since: '5',
      protocolVersion: 3,
    });
    expect(PullQuerySchema.safeParse({ since: '5' }).success).toBe(false);
    expect(PullQuerySchema.safeParse({ since: '5', protocolVersion: '2' }).success).toBe(false);
  });
});

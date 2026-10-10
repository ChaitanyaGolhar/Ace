import { describe, expect, it } from 'vitest';
import { BackupSchema } from '../src';
import { makeCard, makeLog, T0 } from './helpers/fixtures';

// The backup file format (brief §10 screen 8, D-309), moved from apps/web in the
// post-M4 audit. Import/export themselves stay in the web app (they use Dexie).

describe('BackupSchema', () => {
  const card = makeCard();
  const deck = {
    id: card.deckId,
    name: 'D',
    source: 'user' as const,
    prebuiltId: null,
    catalogSlug: null,
    catalogVersion: null,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
  };
  const valid = {
    format: 'recall-backup',
    version: 2,
    exportedAt: T0,
    decks: [deck],
    cards: [card],
    reviewLogs: [makeLog({ cardId: card.id })],
  };

  it('accepts a valid backup, including tombstones and undone logs', () => {
    expect(BackupSchema.parse(valid)).toEqual(valid);
    const withHistory = {
      ...valid,
      cards: [{ ...card, deletedAt: T0 + 1 }],
      reviewLogs: [makeLog({ cardId: card.id, voidedAt: T0 + 5 })],
    };
    expect(BackupSchema.safeParse(withHistory).success).toBe(true);
  });

  it('rejects another format or version', () => {
    expect(BackupSchema.safeParse({ ...valid, format: 'anki' }).success).toBe(false);
    expect(BackupSchema.safeParse({ ...valid, version: 3 }).success).toBe(false);
  });

  it('rejects invalid rows (all-or-nothing import)', () => {
    expect(BackupSchema.safeParse({ ...valid, cards: [{ ...card, id: 'nope' }] }).success).toBe(
      false,
    );
    expect(BackupSchema.safeParse({ ...valid, reviewLogs: [{ rating: 9 }] }).success).toBe(false);
    expect(BackupSchema.safeParse({ ...valid, decks: undefined }).success).toBe(false);
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  CardIdSchema,
  catalogCardId,
  contentHash,
  sha1Hex,
  Uuid,
  uuidV5,
  type CardContent,
} from '../src';

// M7 (BUILD_BRIEF_M6_M8 §7.5): catalog card ids are derived from (local deckId, card key)
// so two devices applying the same update create the same ids, and sync merges them.
// Core must stay pure (no `crypto`), so SHA-1 is implemented here and checked against
// Node's.

const nodeSha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

describe('sha1Hex', () => {
  it('matches the FIPS 180 test vectors', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });

  it('matches Node for every length around the block boundaries, and for Unicode', () => {
    for (let n = 0; n < 200; n++) {
      const s = 'x'.repeat(n);
      expect(sha1Hex(s), `length ${String(n)}`).toBe(nodeSha1(s));
    }
    for (const s of ['é', 'é', '日本語のカード', '🧠 emoji', 'Ünïcödé — “quotes”']) {
      expect(sha1Hex(s)).toBe(nodeSha1(s));
    }
    for (let i = 0; i < 50; i++) {
      const s = randomBytes(1 + ((i * 37) % 300)).toString('base64');
      expect(sha1Hex(s)).toBe(nodeSha1(s));
    }
  });
});

describe('uuidV5', () => {
  it('matches the well-known example (DNS namespace, "www.example.com")', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});

describe('catalogCardId', () => {
  const deckA = '01920000-0000-7000-8000-000000000001';
  const deckB = '01920000-0000-7000-8000-000000000002';

  it('is deterministic for (deck, key)', () => {
    expect(catalogCardId(deckA, 'u1-001')).toBe(catalogCardId(deckA, 'u1-001'));
  });

  it('differs per deck and per key', () => {
    const ids = new Set([
      catalogCardId(deckA, 'u1-001'),
      catalogCardId(deckA, 'u1-002'),
      catalogCardId(deckB, 'u1-001'),
    ]);
    expect(ids.size).toBe(3);
  });

  it('is a version-5 UUID that card ids accept, while deck ids stay v7-only', () => {
    const id = catalogCardId(deckA, 'u1-001');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(CardIdSchema.safeParse(id).success).toBe(true);
    expect(CardIdSchema.safeParse(deckA).success).toBe(true); // ordinary cards: v7
    expect(Uuid.safeParse(id).success).toBe(false);
    expect(CardIdSchema.safeParse('not-a-uuid').success).toBe(false);
    // Other versions are still refused.
    expect(CardIdSchema.safeParse('2ed6657d-e927-468b-95e1-2665a8aea6a2').success).toBe(false);
  });
});

describe('contentHash', () => {
  const mcq: CardContent = {
    type: 'mcq',
    question: 'Q?',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correct: 'b',
    explanation: null,
  };

  it('is a 40-character hex digest of the canonical JSON', () => {
    expect(contentHash(mcq)).toMatch(/^[0-9a-f]{40}$/);
    expect(contentHash(mcq)).toBe(sha1Hex(canonicalJson(mcq)));
  });

  it('ignores object key order (jsonb reorders keys), but not array order', () => {
    const reordered = JSON.parse(
      '{"explanation":null,"correct":"b","options":[{"text":"A","id":"a"},{"text":"B","id":"b"}],"question":"Q?","type":"mcq"}',
    ) as CardContent;
    expect(contentHash(reordered)).toBe(contentHash(mcq));
    const swapped: CardContent = { ...mcq, options: [...mcq.options].reverse() };
    expect(contentHash(swapped)).not.toBe(contentHash(mcq));
  });

  it('changes when any text changes', () => {
    expect(contentHash({ ...mcq, question: 'Q!' })).not.toBe(contentHash(mcq));
  });
});

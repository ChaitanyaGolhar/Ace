import { describe, expect, it } from 'vitest';
import { PrebuiltDeckSchema } from '../src';

const valid = {
  prebuiltId: 'dbms-basics-v1',
  name: 'DBMS Basics',
  description: 'Core DBMS concepts for semester and GATE revision.',
  version: 1,
  cards: [
    { front: 'What does ACID stand for?', back: 'Atomicity, Consistency, Isolation, Durability' },
  ],
};

describe('PrebuiltDeckSchema (content/decks/*.json)', () => {
  it('accepts a valid deck', () => {
    expect(PrebuiltDeckSchema.parse(valid)).toEqual(valid);
  });

  it('requires a lower-case slug id', () => {
    expect(PrebuiltDeckSchema.safeParse({ ...valid, prebuiltId: 'DBMS Basics' }).success).toBe(
      false,
    );
    expect(PrebuiltDeckSchema.safeParse({ ...valid, prebuiltId: '' }).success).toBe(false);
  });

  it('requires at least one card, each with non-empty front and back within the limits', () => {
    expect(PrebuiltDeckSchema.safeParse({ ...valid, cards: [] }).success).toBe(false);
    expect(
      PrebuiltDeckSchema.safeParse({ ...valid, cards: [{ front: '', back: 'x' }] }).success,
    ).toBe(false);
    expect(
      PrebuiltDeckSchema.safeParse({ ...valid, cards: [{ front: 'q', back: 'a'.repeat(20_001) }] })
        .success,
    ).toBe(false);
  });

  it('requires a positive integer version, a name within 200 chars and a description', () => {
    expect(PrebuiltDeckSchema.safeParse({ ...valid, version: 0 }).success).toBe(false);
    expect(PrebuiltDeckSchema.safeParse({ ...valid, name: 'x'.repeat(201) }).success).toBe(false);
    expect(PrebuiltDeckSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
  });

  it('rejects unknown fields (catches typos in hand-written files)', () => {
    expect(PrebuiltDeckSchema.safeParse({ ...valid, descripton: 'typo' }).success).toBe(false);
    expect(
      PrebuiltDeckSchema.safeParse({ ...valid, cards: [{ front: 'q', back: 'a', hint: 'x' }] })
        .success,
    ).toBe(false);
  });

  it('rejects duplicate questions within a deck', () => {
    const dup = { front: 'Same?', back: 'a' };
    expect(
      PrebuiltDeckSchema.safeParse({ ...valid, cards: [dup, { ...dup, back: 'b' }] }).success,
    ).toBe(false);
  });
});

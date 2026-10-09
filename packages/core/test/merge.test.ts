import { describe, expect, it } from 'vitest';
import { lww, mergeLog, type Card } from '../src';
import { makeCard, makeLog, T0, uuid } from './helpers/fixtures';
import { pick, randomInt, seededRandom } from './helpers/random';

describe('lww', () => {
  it('newer edit wins, regardless of argument order', () => {
    const older = makeCard({ front: 'old', updatedAt: T0 });
    const newer = makeCard({ front: 'new', updatedAt: T0 + 1 });
    expect(lww(older, newer)).toBe(newer);
    expect(lww(newer, older)).toBe(newer);
  });

  it('equal timestamp falls back to the higher id', () => {
    const low = makeCard({ id: uuid(1), updatedAt: T0 });
    const high = makeCard({ id: uuid(2), updatedAt: T0 });
    expect(lww(low, high)).toBe(high);
    expect(lww(high, low)).toBe(high);
  });

  it('a tombstone beats an older edit', () => {
    const edit = makeCard({ front: 'edited', updatedAt: T0 });
    const tombstone = makeCard({ updatedAt: T0 + 1, deletedAt: T0 + 1 });
    expect(lww(edit, tombstone)).toBe(tombstone);
    expect(lww(tombstone, edit)).toBe(tombstone);
  });

  it('a tombstone beats an edit with an equal updatedAt, even if the edit has a higher id', () => {
    const edit = makeCard({ id: uuid(9), front: 'edited', updatedAt: T0 });
    const tombstone = makeCard({ id: uuid(1), updatedAt: T0, deletedAt: T0 });
    expect(lww(edit, tombstone)).toBe(tombstone);
    expect(lww(tombstone, edit)).toBe(tombstone);
  });

  it('an edit strictly newer than a tombstone wins (the row is restored)', () => {
    const tombstone = makeCard({ updatedAt: T0, deletedAt: T0 });
    const laterEdit = makeCard({ front: 'edited', updatedAt: T0 + 1 });
    expect(lww(tombstone, laterEdit)).toBe(laterEdit);
  });

  it('two different versions of the same row with equal updatedAt resolve deterministically', () => {
    // Same id, same timestamp, different content: rare (two devices editing in the
    // same millisecond), but both devices must still pick the same winner.
    const a = makeCard({ front: 'from device A', updatedAt: T0 });
    const b = makeCard({ front: 'from device B', updatedAt: T0 });
    expect(lww(a, b)).toBe(lww(b, a));
  });

  it('is commutative, associative and idempotent (seeded property test)', () => {
    const rand = seededRandom(42);
    const variant = (): Card =>
      makeCard({
        id: uuid(randomInt(rand, 1, 3)),
        front: pick(rand, ['a', 'b', 'c']),
        updatedAt: T0 + randomInt(rand, 0, 2),
        deletedAt: rand() < 0.3 ? T0 : null,
      });
    for (let i = 0; i < 500; i++) {
      const [a, b, c] = [variant(), variant(), variant()];
      expect(lww(a, b)).toEqual(lww(b, a));
      expect(lww(lww(a, b), c)).toEqual(lww(a, lww(b, c)));
      expect(lww(a, a)).toBe(a);
    }
  });
});

describe('mergeLog', () => {
  it('keeps the earliest non-null voidedAt', () => {
    const a = makeLog({ voidedAt: T0 + 5 });
    const b = makeLog({ voidedAt: T0 + 2 });
    expect(mergeLog(a, b).voidedAt).toBe(T0 + 2);
    expect(mergeLog(b, a).voidedAt).toBe(T0 + 2);
  });

  it('never un-voids a log: voided + not voided stays voided (append-only invariant)', () => {
    const voided = makeLog({ voidedAt: T0 + 1 });
    const live = makeLog({ voidedAt: null });
    expect(mergeLog(voided, live).voidedAt).toBe(T0 + 1);
    expect(mergeLog(live, voided).voidedAt).toBe(T0 + 1);
  });

  it('two live copies stay live and unchanged', () => {
    const log = makeLog();
    expect(mergeLog(log, { ...log })).toEqual(log);
  });

  it('refuses to merge logs with different ids', () => {
    expect(() => mergeLog(makeLog({ id: uuid(1) }), makeLog({ id: uuid(2) }))).toThrow();
  });

  it('is commutative even if the immutable fields were somehow corrupted', () => {
    const a = makeLog({ rating: 1, voidedAt: null });
    const b = makeLog({ rating: 4, voidedAt: T0 });
    expect(mergeLog(a, b)).toEqual(mergeLog(b, a));
    expect(mergeLog(a, b).voidedAt).toBe(T0);
  });

  it('does not mutate its inputs', () => {
    const a = Object.freeze(makeLog({ voidedAt: null }));
    const b = Object.freeze(makeLog({ voidedAt: T0 }));
    expect(() => mergeLog(a, b)).not.toThrow();
    expect(a.voidedAt).toBeNull();
  });
});

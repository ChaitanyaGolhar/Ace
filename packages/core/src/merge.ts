import type { ReviewLog } from './schemas';

interface Versioned {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Last-write-wins between two versions of a deck or card. Returns one of its inputs.
 *
 * Order of tie-breaks:
 *  1. newer `updatedAt` wins;
 *  2. on equal `updatedAt`, a tombstone (non-null `deletedAt`) wins;
 *  3. then the higher `id` (lexical) wins;
 *  4. then, for two different versions of the *same* row, the one with the greater
 *     canonical serialisation wins. The brief's id tie-break can't separate two
 *     versions of one row (they share an id), and without this step `lww(a, b)` and
 *     `lww(b, a)` could disagree, so two devices would never converge.
 *
 * Because the result depends only on the values, not the argument order, lww is
 * commutative and associative: merging the same set of versions in any order on any
 * device gives the same winner.
 */
export function lww<T extends Versioned>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const aDeleted = a.deletedAt !== null;
  const bDeleted = b.deletedAt !== null;
  if (aDeleted !== bDeleted) return aDeleted ? a : b;
  if (a.id !== b.id) return a.id > b.id ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

/**
 * Merges two copies of the same review log. Logs are append-only, so the only field
 * that may legitimately differ is `voidedAt`, and it can only go null → timestamp.
 * The merge keeps the earliest non-null `voidedAt`, so a voided log stays voided.
 */
export function mergeLog(a: ReviewLog, b: ReviewLog): ReviewLog {
  if (a.id !== b.id) {
    throw new Error(`mergeLog: ids differ (${a.id} vs ${b.id})`);
  }
  // The other fields should be identical. If a bug ever made them differ, pick a
  // base deterministically so every device still ends up with the same log.
  const base = canonical({ ...a, voidedAt: null }) <= canonical({ ...b, voidedAt: null }) ? a : b;
  return { ...base, voidedAt: earliest(a.voidedAt, b.voidedAt) };
}

function earliest(x: number | null, y: number | null): number | null {
  if (x === null) return y;
  if (y === null) return x;
  return Math.min(x, y);
}

/** Key-order-independent serialisation of a flat row, used only for tie-breaking. */
function canonical(row: object): string {
  return JSON.stringify(Object.entries(row).sort(([k1], [k2]) => (k1 < k2 ? -1 : 1)));
}

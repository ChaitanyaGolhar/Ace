import type { ReviewLog } from './schemas';

interface Versioned {
  id: string;
  updatedAt: number;
  deletedAt: number | null;
}

/**
 * Last-write-wins between two versions of a deck or card. Returns one of its inputs.
 *
 * Rules, in order:
 *  1. if exactly one version is a tombstone (non-null `deletedAt`), it wins, however
 *     old it is. Tombstones are sticky (invariant 9): once a row is deleted anywhere,
 *     no edit can bring it back, so "deleted" is a one-way door like `voidedAt`;
 *  2. otherwise (both live, or both tombstones) the newer `updatedAt` wins;
 *  3. then the higher `id` (lexical) wins;
 *  4. then, for two different versions of the *same* row, the one with the greater
 *     canonical serialisation wins. The id tie-break can't separate two versions of
 *     one row (they share an id), and without this step `lww(a, b)` and `lww(b, a)`
 *     could disagree, so two devices would never converge.
 *
 * Because the result depends only on the values, not the argument order, lww is
 * commutative and associative: merging the same set of versions in any order on any
 * device gives the same winner, and if any of them is a tombstone, so is the winner.
 */
export function lww<T extends Versioned>(a: T, b: T): T {
  const aDeleted = a.deletedAt !== null;
  const bDeleted = b.deletedAt !== null;
  if (aDeleted !== bDeleted) return aDeleted ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
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
  const neutral = (l: ReviewLog) => canonical({ ...l, voidedAt: null, outcome: null });
  const base = neutral(a) <= neutral(b) ? a : b;
  return {
    ...base,
    voidedAt: earliest(a.voidedAt, b.voidedAt),
    // A pre-M6 client strips `outcome` (§6.6). It never changes once written, so a copy
    // that has one is the true one.
    outcome: base.outcome ?? (base === a ? b.outcome : a.outcome),
  };
}

function earliest(x: number | null, y: number | null): number | null {
  if (x === null) return y;
  if (y === null) return x;
  return Math.min(x, y);
}

/**
 * Key-order-independent serialisation, at every depth (card `content`, log `outcome`):
 * Postgres `jsonb` and different clients may order object keys differently. Arrays keep
 * their order, which is meaningful (MCQ options, key points).
 */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]);
  }
  return value;
}

/**
 * Key-order-independent equality of two flat rows: "did merging change anything?".
 * Used by the server push, the client pull and backup import alike.
 */
export function sameRow(a: object, b: object): boolean {
  return canonical(a) === canonical(b);
}

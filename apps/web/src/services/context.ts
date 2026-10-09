import type { RecallDB } from '../db/db';

/**
 * Everything a service needs from the outside world, passed in explicitly so tests
 * can use an in-memory database, a fake clock and predictable ids.
 */
export interface AppContext {
  db: RecallDB;
  /** Current time, epoch ms. */
  now: () => number;
  /** New UUID v7. */
  newId: () => string;
}

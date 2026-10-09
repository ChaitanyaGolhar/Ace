import { RecallDB } from '../src/db/db';
import type { AppContext } from '../src/services/context';

/** 2026-10-10T10:00:00Z, which is 15:30 in Asia/Kolkata. */
export const T0 = Date.UTC(2026, 9, 10, 10, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

let dbCounter = 0;

export interface TestContext extends AppContext {
  setNow: (t: number) => void;
  advance: (ms: number) => void;
}

/**
 * A fresh in-memory database (fake-indexeddb), a fake clock starting at `start`, and
 * deterministic, valid, increasing UUID v7 ids.
 */
export function makeTestContext(start = T0): TestContext {
  let now = start;
  let nextId = 1;
  dbCounter += 1;
  return {
    db: new RecallDB(`test-${String(dbCounter)}`),
    now: () => now,
    newId: () => `01920000-0000-7000-8000-${(nextId++).toString(16).padStart(12, '0')}`,
    setNow: (t) => {
      now = t;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

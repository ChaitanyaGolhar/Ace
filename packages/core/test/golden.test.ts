// Invariant 8: any change to scheduling output must bump SCHEDULER_VERSION, because
// that bump is what makes clients rebuild their stored CardStates by replay.
//
// test/fixtures/golden.json stores fixed review histories, the states replay produced
// for them, and the SCHEDULER_VERSION at the time. If the output changes (new FSRS
// params, new replay logic, a ts-fsrs upgrade) without a version bump, this fails.
//
// To accept an intentional change: bump SCHEDULER_VERSION, then run
//   pnpm --filter @recall/core golden:update
// The update refuses to overwrite the fixture if the version was not bumped.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  replay,
  SCHEDULER_VERSION,
  type Card,
  type CardState,
  type Rating,
  type ReviewLog,
} from '../src';
import { DAY, makeCard, makeLog, MINUTE, T0, uuid } from './helpers/fixtures';
import { pick, randomInt, seededRandom } from './helpers/random';

interface Golden {
  schedulerVersion: number;
  cases: { card: Card; logs: ReviewLog[]; expected: CardState }[];
}

const FIXTURE = join(import.meta.dirname, 'fixtures', 'golden.json');

function generateCases(): Golden['cases'] {
  const rand = seededRandom(20261010);
  return Array.from({ length: 12 }, (_, c) => {
    const card = makeCard({ id: uuid(c + 1), createdAt: T0 });
    let at = T0;
    const logs = Array.from({ length: 20 }, (_, i) => {
      at += pick(rand, [MINUTE, 10 * MINUTE, DAY, 4 * DAY, 30 * DAY]);
      return makeLog({
        id: uuid(1000 * (c + 1) + i),
        cardId: card.id,
        rating: pick(rand, [1, 2, 3, 4] as const satisfies readonly Rating[]),
        reviewedAt: at,
        durationMs: randomInt(rand, 1000, 10_000),
        voidedAt: rand() < 0.1 ? at + MINUTE : null,
      });
    });
    return { card, logs, expected: replay(card, logs) };
  });
}

function readFixture(): Golden | null {
  return existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Golden) : null;
}

describe('SCHEDULER_VERSION golden replay', () => {
  if (process.env.UPDATE_GOLDEN === '1') {
    it('updates the golden fixture', () => {
      const existing = readFixture();
      if (existing?.schedulerVersion === SCHEDULER_VERSION) {
        const unchanged = existing.cases.every(({ card, logs, expected }) =>
          isDeepEqual(replay(card, logs), expected),
        );
        if (!unchanged) {
          throw new Error('Scheduling output changed: bump SCHEDULER_VERSION before updating.');
        }
      }
      const golden: Golden = { schedulerVersion: SCHEDULER_VERSION, cases: generateCases() };
      writeFileSync(FIXTURE, `${JSON.stringify(golden, null, 2)}\n`);
    });
    return;
  }

  const golden = readFixture();

  it('fixture exists', () => {
    expect(
      golden,
      'Missing fixture: run `pnpm --filter @recall/core golden:update`',
    ).not.toBeNull();
  });

  it('fixture was produced by the current SCHEDULER_VERSION', () => {
    expect(
      golden?.schedulerVersion,
      'SCHEDULER_VERSION changed: run `pnpm --filter @recall/core golden:update`',
    ).toBe(SCHEDULER_VERSION);
  });

  it('replay output is unchanged for this SCHEDULER_VERSION', () => {
    for (const { card, logs, expected } of golden?.cases ?? []) {
      expect(
        replay(card, logs),
        'Scheduling output changed: bump SCHEDULER_VERSION, then run golden:update',
      ).toEqual(expected);
    }
  });

  it('covers both review and (re)learning states', () => {
    const states = new Set(golden?.cases.map((c) => c.expected.state));
    expect(states.has('review') && (states.has('learning') || states.has('relearning'))).toBe(true);
  });
});

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

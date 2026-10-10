import {
  EventSchema,
  lww,
  MAX_PULL_LIMIT,
  MAX_PUSH_ROWS,
  PROTOCOL_VERSION,
  mergeLog,
  replay,
  sameRow,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@recall/core';
import {
  withoutSyncFields,
  type LocalCard,
  type LocalDeck,
  type LocalEvent,
  type LocalReviewLog,
} from '../db/db';
import { getMeta, setMeta } from '../db/meta';
import type { AppContext } from '../services/context';
import type { SyncTransport } from './transport';

// One sync round (brief §8): push everything dirty, then pull everything new.

/** The localVersion of every row in a push, as it was when the push was built. */
export interface PushSnapshot {
  decks: Map<string, number>;
  cards: Map<string, number>;
  reviewLogs: Map<string, number>;
  events: Map<string, number>;
}

/**
 * Up to 500 dirty rows, decks first, then cards, then logs (the server applies a batch
 * in that order, and a card's deck must reach it first). Rows in `exclude` were already
 * pushed in this round and wait for the next one.
 */
export async function buildPushBatch(
  ctx: AppContext,
  deviceId: string,
  exclude: ReadonlySet<string> = new Set(),
): Promise<{ request: PushRequest; snapshot: PushSnapshot }> {
  const { db } = ctx;
  return db.transaction('r', [db.decks, db.cards, db.reviewLogs, db.events], async () => {
    let room = MAX_PUSH_ROWS;
    const take = async <T extends { id: string }>(rows: Promise<T[]>): Promise<T[]> => {
      const picked = (await rows).filter((r) => !exclude.has(r.id)).slice(0, room);
      room -= picked.length;
      return picked;
    };
    const decks: LocalDeck[] = await take(db.decks.where('dirty').equals(1).toArray());
    const cards: LocalCard[] = await take(db.cards.where('dirty').equals(1).toArray());
    const logs: LocalReviewLog[] = await take(db.reviewLogs.where('dirty').equals(1).toArray());
    const events: LocalEvent[] = await take(db.events.where('dirty').equals(1).toArray());
    return {
      request: {
        protocolVersion: PROTOCOL_VERSION,
        deviceId,
        decks: decks.map(withoutSyncFields),
        cards: cards.map(withoutSyncFields),
        reviewLogs: logs.map(withoutSyncFields),
        // Re-validate: TypeScript's Omit doesn't keep the event union's per-type shapes.
        events: events.map((e) => EventSchema.parse(withoutSyncFields(e))),
      },
      snapshot: {
        decks: new Map(decks.map((r) => [r.id, r.localVersion])),
        cards: new Map(cards.map((r) => [r.id, r.localVersion])),
        reviewLogs: new Map(logs.map((r) => [r.id, r.localVersion])),
        events: new Map(events.map((r) => [r.id, r.localVersion])),
      },
    };
  });
}

/**
 * Clears `dirty` on accepted rows, but only if `localVersion` hasn't changed since the
 * push was built: an edit made while the request was in flight stays dirty, so it is
 * pushed next time instead of being lost (§8.2).
 */
export async function markPushed(
  ctx: AppContext,
  snapshot: PushSnapshot,
  accepted: PushResponse['accepted'],
): Promise<void> {
  const { db } = ctx;
  await db.transaction('rw', [db.decks, db.cards, db.reviewLogs, db.events], async () => {
    for (const id of accepted.decks) {
      const row = await db.decks.get(id);
      if (row && row.localVersion === snapshot.decks.get(id))
        await db.decks.put({ ...row, dirty: 0 });
    }
    for (const id of accepted.cards) {
      const row = await db.cards.get(id);
      if (row && row.localVersion === snapshot.cards.get(id))
        await db.cards.put({ ...row, dirty: 0 });
    }
    for (const id of accepted.reviewLogs) {
      const row = await db.reviewLogs.get(id);
      if (row && row.localVersion === snapshot.reviewLogs.get(id)) {
        await db.reviewLogs.put({ ...row, dirty: 0 });
      }
    }
    for (const id of accepted.events) {
      const row = await db.events.get(id);
      if (row && row.localVersion === snapshot.events.get(id)) {
        await db.events.put({ ...row, dirty: 0 });
      }
    }
  });
}

/**
 * Which version of a deck or card to keep when a pulled row meets a local one. A local
 * row with unsent changes merges by last-write-wins. A clean one (nothing unsent) is just
 * an earlier copy of what the server has, so the server's version replaces it: that also
 * repairs rows an older version of the app stored without their M6 fields (§6.6).
 */
function pick<T extends { id: string; updatedAt: number; deletedAt: number | null }>(
  dirty: 0 | 1,
  local: T,
  remote: T,
): T {
  return dirty === 1 ? lww(local, remote) : remote;
}

/**
 * Applies one pulled page in a single Dexie transaction (§8.3): decks/cards by `lww`
 * against the local copy, logs inserted or merged with `mergeLog`, every affected card
 * replayed, and the cursor saved — all or nothing.
 */
export async function applyPullPage(ctx: AppContext, page: PullResponse): Promise<void> {
  const { db } = ctx;
  await db.transaction(
    'rw',
    [db.decks, db.cards, db.reviewLogs, db.cardStates, db.meta, db.events],
    async () => {
      for (const remote of page.decks) {
        const local = await db.decks.get(remote.id);
        if (!local) {
          await db.decks.add({ ...remote, dirty: 0, localVersion: 0 });
          continue;
        }
        const current = withoutSyncFields(local);
        const winner = pick(local.dirty, current, remote);
        if (!sameRow(winner, current)) {
          // The server's version won; the local one (even if dirty) is superseded.
          await db.decks.put({ ...winner, dirty: 0, localVersion: local.localVersion + 1 });
        }
      }

      const affected = new Set<string>();
      for (const remote of page.cards) {
        const local = await db.cards.get(remote.id);
        if (!local) {
          await db.cards.add({ ...remote, dirty: 0, localVersion: 0 });
          affected.add(remote.id);
          continue;
        }
        const current = withoutSyncFields(local);
        const winner = pick(local.dirty, current, remote);
        if (!sameRow(winner, current)) {
          await db.cards.put({ ...winner, dirty: 0, localVersion: local.localVersion + 1 });
          affected.add(remote.id);
        }
      }

      for (const remote of page.reviewLogs) {
        const local = await db.reviewLogs.get(remote.id);
        if (!local) {
          await db.reviewLogs.add({ ...remote, dirty: 0, localVersion: 0 });
          affected.add(remote.cardId);
          continue;
        }
        const current = withoutSyncFields(local);
        const merged = mergeLog(current, remote);
        if (!sameRow(merged, current)) {
          // voidedAt (an undo elsewhere), or an outcome this device's older app stripped.
          await db.reviewLogs.put({
            ...merged,
            dirty: local.dirty,
            localVersion: local.localVersion + 1,
          });
          affected.add(remote.cardId);
        }
      }

      // Events are append-only: insert if absent, never changed.
      for (const remote of page.events) {
        if (!(await db.events.get(remote.id))) {
          await db.events.add({ ...remote, dirty: 0, localVersion: 0 });
        }
      }

      // CardState is never synced: re-derive it for every card whose row or logs changed.
      // (A log can arrive before its card on an earlier page; the card's own arrival
      // triggers the replay then.)
      for (const cardId of affected) {
        const card = await db.cards.get(cardId);
        if (!card) continue;
        const logs = await db.reviewLogs.where('cardId').equals(cardId).toArray();
        await db.cardStates.put(replay(card, logs));
      }

      await setMeta(db, 'syncCursor', page.nextCursor);
    },
  );
}

export interface SyncOptions {
  pullLimit?: number;
}

/** Push, then pull (§8.4). Throws on any transport error; nothing half-applied remains. */
export async function syncOnce(
  ctx: AppContext,
  transport: SyncTransport,
  options: SyncOptions = {},
): Promise<void> {
  const deviceId = (await getMeta(ctx.db, 'deviceId')) ?? 'unknown';

  const pushed = new Set<string>();
  for (;;) {
    const { request, snapshot } = await buildPushBatch(ctx, deviceId, pushed);
    const size =
      request.decks.length +
      request.cards.length +
      request.reviewLogs.length +
      request.events.length;
    if (size === 0) break;
    const response = await transport.push(request);
    await markPushed(ctx, snapshot, response.accepted);
    for (const r of [
      ...request.decks,
      ...request.cards,
      ...request.reviewLogs,
      ...request.events,
    ]) {
      pushed.add(r.id);
    }
  }

  const limit = options.pullLimit ?? MAX_PULL_LIMIT;
  for (;;) {
    const cursor = (await getMeta(ctx.db, 'syncCursor')) ?? '0';
    const page = await transport.pull(cursor, limit);
    await applyPullPage(ctx, page);
    if (!page.hasMore) break;
  }
}

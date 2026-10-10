import { EventSchema, type EventProps, type EventType } from '@recall/core';
import type { LocalEvent } from '../db/db';
import { getMeta } from '../db/meta';
import type { AppContext } from './context';

/**
 * Records a product event (M4). Validated with the core schema, whose payloads are
 * strict and can't hold card text. Append-only: events are never edited or deleted;
 * they sync like review logs. Callers inside a Dexie transaction must include the
 * `events` and `meta` tables in it.
 */
export async function recordEvent<T extends EventType>(
  ctx: AppContext,
  type: T,
  props: EventProps<T>,
): Promise<LocalEvent> {
  const deviceId = (await getMeta(ctx.db, 'deviceId')) ?? 'unknown';
  const event = EventSchema.parse({
    id: ctx.newId(),
    type,
    props,
    occurredAt: ctx.now(),
    deviceId,
  });
  const row: LocalEvent = { ...event, dirty: 1, localVersion: 1 };
  await ctx.db.events.add(row);
  return row;
}

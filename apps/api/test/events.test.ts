import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENTS_VERSION, eventTypesFor, type AppEvent, type PullResponse } from '@recall/core';
import { closeTestPrisma, makeTestApp, resetDb, signIn } from './helpers';
import { dump, event, pull, push } from './syncFixtures';

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

describe('events through /sync/push and /sync/pull', () => {
  it('are stored once (insert-if-absent): pushing the same events twice changes nothing', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const events = [
      event(),
      event({ type: 'session_completed', props: { reviewed: 5, durationMs: 60_000 } }),
      event({ type: 'deck_added_prebuilt', props: { prebuiltId: 'dbms-basics-v1' } }),
    ];
    const res = await push(t, cookie, { events });
    expect(res.status).toBe(200);
    expect((res.body as { accepted: { events: string[] } }).accepted.events).toEqual(
      events.map((e) => e.id),
    );
    const once = await dump(t);
    await push(t, cookie, { events }).expect(200);
    expect(await dump(t)).toEqual(once);
    expect((once.events as unknown[]).length).toBe(3);
  });

  it('are append-only: a different copy of an existing event never changes it', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const e = event({ type: 'session_completed', props: { reviewed: 5, durationMs: 60_000 } });
    await push(t, cookie, { events: [e] }).expect(200);
    const altered = { ...e, props: { reviewed: 99, durationMs: 1 } } as AppEvent;
    await push(t, cookie, { events: [altered] }).expect(200);
    const pulled = (await pull(t, cookie)).body as PullResponse;
    expect(pulled.events).toEqual([e]);
  });

  it('an app that declares no event catalogue (M8 and older) never pulls a type it can’t parse', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const known = event({ occurredAt: 1 });
    const added = [
      event({ type: 'break_return_shown', props: { due: 45, daysAway: 4 }, occurredAt: 2 }),
      event({ type: 'capped_session_started', props: { cap: 20, due: 45 }, occurredAt: 3 }),
    ];
    const last = event({ type: 'signed_in', occurredAt: 4 });
    await push(t, cookie, { events: [known, ...added, last] }).expect(200);

    const old = (await pull(t, cookie)).body as PullResponse;
    expect(old.events.map((e) => e.type)).toEqual(['app_opened', 'signed_in']);
    // What an M8 app's schema (no break-return types) makes of this page: it parses.
    const m8Types = new Set(eventTypesFor(1));
    expect(old.events.every((e) => m8Types.has(e.type))).toBe(true);
    // Its cursor still moves past everything it was sent.
    const again = (await pull(t, cookie, old.nextCursor)).body as PullResponse;
    expect(again.events).toEqual([]);
    expect(again.hasMore).toBe(false);

    const current = (await pull(t, cookie, '0', undefined, EVENTS_VERSION)).body as PullResponse;
    expect(current.events.map((e) => e.type)).toEqual([
      'app_opened',
      'break_return_shown',
      'capped_session_started',
      'signed_in',
    ]);
  });

  it('reject card text in payloads (400)', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const bad = { ...event(), props: { front: 'What is ACID?' } };
    const res = await push(t, cookie, { events: [bad as never] });
    expect(res.status).toBe(400);
  });

  it('ownership: an event id that belongs to another user rejects the batch (403)', async () => {
    const t = makeTestApp();
    const alice = await signIn(t, 'alice@example.com');
    const bob = await signIn(t, 'bob@example.com');
    const e = event();
    await push(t, alice, { events: [e] }).expect(200);
    expect((await push(t, bob, { events: [e] })).status).toBe(403);
  });

  it('are pulled in serverSeq order with the other rows, and count towards page limits', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const events = Array.from({ length: 5 }, () => event());
    await push(t, cookie, { events }).expect(200);
    const first = (await pull(t, cookie, '0', 3)).body as PullResponse;
    expect(first.events).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const rest = (await pull(t, cookie, first.nextCursor, 3)).body as PullResponse;
    expect([...first.events, ...rest.events].map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(rest.hasMore).toBe(false);
  });
});

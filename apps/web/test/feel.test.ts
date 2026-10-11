import { buildQueue, type Queue } from '@recall/core';
import { describe, expect, it } from 'vitest';
import { initialize } from '../src/services/bootstrap';
import { createCard, createTypedCard } from '../src/services/cards';
import {
  breakReturnFor,
  BREAK_MIN_DUE,
  noteBreakReturnShown,
  SESSION_CAP,
} from '../src/services/breakReturn';
import { farOffLine, nextDueLine, rememberedLine } from '../src/services/completion';
import { createDeck } from '../src/services/decks';
import { loadHome, loadNextDue } from '../src/services/overview';
import { capQueue, loadQueue, loadQueueInput } from '../src/services/queue';
import { rateCard, undoLastReview } from '../src/services/review';
import { completeSession, getSession, sessionRecap, startSession } from '../src/services/session';
import { updateSettings } from '../src/services/settings';
import { DAY, HOUR, makeTestContext, MINUTE, type TestContext } from './helpers';

// Feel pass (moments 2 and 3): the completion numbers, coming back after a break, and
// capped sessions. The cap is a session limit only; it never changes the schedule.

/** 2026-10-10 15:30 IST. */
const NOW = Date.parse('2026-10-10T10:00:00Z');
const tz = 'Asia/Kolkata';
const opts = { browserTimeZone: 'UTC' };

async function setup(): Promise<TestContext> {
  const ctx = makeTestContext(NOW);
  await initialize(ctx, { requestPersist: undefined });
  await updateSettings(ctx, { timeZone: tz, rolloverHour: 4 });
  return ctx;
}

/**
 * `n` cards, each studied once (Easy) `ago` before NOW, an hour apart, so card i falls due
 * before card i+1. All overdue at NOW. Returns their ids in due order.
 */
async function overdueCards(ctx: TestContext, n: number, ago = 40 * DAY): Promise<string[]> {
  const deck = await createDeck(ctx, 'Networks');
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ctx.setNow(NOW - ago + i * HOUR);
    const card = await createCard(ctx, deck.id, `q${String(i)}`, 'a');
    await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 1000 });
    ids.push(card.id);
  }
  ctx.setNow(NOW);
  return ids;
}

describe('coming back after a break: the trigger', () => {
  const at = (iso: string) => Date.parse(iso);
  const base = { now: at('2026-10-10T10:00:00Z'), timeZone: tz, rolloverHour: 4 };

  it('needs no review for 2+ study days AND more than 30 cards due', () => {
    expect(BREAK_MIN_DUE).toBe(30);
    const twoDaysAgo = at('2026-10-08T10:00:00Z');
    expect(breakReturnFor({ ...base, lastReviewAt: twoDaysAgo, due: 31 })).toEqual({
      due: 31,
      daysAway: 2,
    });
    expect(breakReturnFor({ ...base, lastReviewAt: twoDaysAgo, due: 30 })).toBeNull();
    expect(
      breakReturnFor({ ...base, lastReviewAt: at('2026-10-09T10:00:00Z'), due: 400 }),
    ).toBeNull();
    expect(breakReturnFor({ ...base, lastReviewAt: base.now - MINUTE, due: 400 })).toBeNull();
    expect(breakReturnFor({ ...base, lastReviewAt: at('2026-09-01T10:00:00Z'), due: 45 })).toEqual({
      due: 45,
      daysAway: 39,
    });
  });

  it('is never shown to someone who has never reviewed (that is a first visit, not a return)', () => {
    expect(breakReturnFor({ ...base, lastReviewAt: null, due: 500 })).toBeNull();
  });

  it('counts study days, with the rollover hour (04:00 IST)', () => {
    // 2026-10-08 03:30 IST still belongs to study day 2026-10-07: 3 study days ago.
    expect(breakReturnFor({ ...base, lastReviewAt: at('2026-10-07T22:00:00Z'), due: 31 })).toEqual({
      due: 31,
      daysAway: 3,
    });
    // Now = 2026-10-10 03:00 IST is still study day 10-09; a review on 10-08 is 1 day ago.
    expect(
      breakReturnFor({
        ...base,
        now: at('2026-10-09T21:30:00Z'),
        lastReviewAt: at('2026-10-08T10:00:00Z'),
        due: 31,
      }),
    ).toBeNull();
  });

  it('loadHome reports it from the latest review that wasn’t undone', async () => {
    const ctx = await setup();
    await overdueCards(ctx, 31);
    expect((await loadHome(ctx, opts)).breakReturn).toEqual({ due: 31, daysAway: 39 });

    // A review today, then undone: still a return after a break.
    const session = await startSession(ctx, null, 'UTC');
    const [first] = (await loadQueue(ctx, opts)).due;
    if (first === undefined) throw new Error('nothing due');
    await rateCard(ctx, { cardId: first, rating: 3, durationMs: 1 });
    expect((await loadHome(ctx, opts)).breakReturn).toBeNull();
    await undoLastReview(ctx, session.startedAt);
    expect((await loadHome(ctx, opts)).breakReturn).toEqual({ due: 31, daysAway: 39 });
  });

  it('is not shown with 30 due', async () => {
    const ctx = await setup();
    await overdueCards(ctx, 30);
    expect((await loadHome(ctx, opts)).breakReturn).toBeNull();
  });

  it('break_return_shown is recorded once per study day, with numbers only', async () => {
    const ctx = await setup();
    await noteBreakReturnShown(ctx, { due: 45, daysAway: 4 }, 'UTC');
    await noteBreakReturnShown(ctx, { due: 45, daysAway: 4 }, 'UTC');
    ctx.advance(DAY);
    await noteBreakReturnShown(ctx, { due: 47, daysAway: 5 }, 'UTC');
    const events = await ctx.db.events.where('type').equals('break_return_shown').toArray();
    expect(events.map((e) => e.props)).toEqual([
      { due: 45, daysAway: 4 },
      { due: 47, daysAway: 5 },
    ]);
  });
});

describe('capped sessions: "Start with 20"', () => {
  it('the cap is the 20 most overdue due cards, most overdue first', async () => {
    const ctx = await setup();
    const ids = await overdueCards(ctx, 25);
    expect(SESSION_CAP).toBe(20);
    const session = await startSession(ctx, null, 'UTC', undefined, SESSION_CAP);
    expect(session.cap).toEqual(ids.slice(0, 20));
    const events = await ctx.db.events
      .filter((e) => e.type === 'session_started' || e.type === 'capped_session_started')
      .toArray();
    expect(events.map((e) => [e.type, e.props])).toEqual([
      ['session_started', { scope: 'all', due: 25, new: 0 }],
      ['capped_session_started', { cap: 20, due: 25 }],
    ]);
  });

  it('a capped queue: only capped cards, in queue order, no new cards', () => {
    const queue: Queue = {
      due: ['a', 'b', 'c', 'd'],
      newCards: ['n1', 'n2'],
      learnAheadNext: { cardId: 'x', due: 1 },
      counts: { due: 4, learning: 0, new: 2 },
    };
    expect(capQueue(queue, ['c', 'a', 'x'])).toMatchObject({
      due: ['a', 'c'],
      newCards: [],
      learnAheadNext: { cardId: 'x', due: 1 },
    });
    expect(capQueue(queue, ['b']).learnAheadNext).toBeNull();
  });

  it('never changes the schedule: states and the uncapped queue are identical', async () => {
    const ctx = await setup();
    await overdueCards(ctx, 25);
    const before = await ctx.db.cardStates.toArray();
    const queueBefore = buildQueue(await loadQueueInput(ctx, 'UTC'));
    await startSession(ctx, null, 'UTC', undefined, SESSION_CAP);
    expect(await ctx.db.cardStates.toArray()).toEqual(before);
    expect(buildQueue(await loadQueueInput(ctx, 'UTC'))).toEqual(queueBefore);
  });

  it('a reload continues the capped session; a full session is a new one', async () => {
    const ctx = await setup();
    await overdueCards(ctx, 25);
    const capped = await startSession(ctx, null, 'UTC', undefined, SESSION_CAP);
    ctx.advance(MINUTE);
    expect(await startSession(ctx, null, 'UTC', undefined, SESSION_CAP)).toEqual(capped);
    ctx.advance(MINUTE);
    const full = await startSession(ctx, null, 'UTC');
    expect(full.cap).toBeUndefined();
    expect(full.startedAt).toBe(NOW + 2 * MINUTE);
  });

  it('"Do 20 more" after a capped session picks the next most overdue cards', async () => {
    const ctx = await setup();
    const ids = await overdueCards(ctx, 25);
    const first = await startSession(ctx, null, 'UTC', undefined, SESSION_CAP);
    for (const id of first.cap ?? []) {
      await rateCard(ctx, { cardId: id, rating: 3, durationMs: 1 });
    }
    await completeSession(ctx);
    ctx.advance(MINUTE);
    const second = await startSession(ctx, null, 'UTC', undefined, SESSION_CAP);
    expect(second.cap).toEqual(ids.slice(20));
    expect((await getSession(ctx))?.cap).toEqual(ids.slice(20));
  });
});

describe('session complete: only true numbers', () => {
  it('remembered = ratings other than Again, or MCQ/cloze correctness where there is one', async () => {
    const ctx = await setup();
    const deck = await createDeck(ctx, 'D');
    const basic = await createCard(ctx, deck.id, 'q', 'a');
    const mcq = await createTypedCard(ctx, deck.id, {
      type: 'mcq',
      question: 'Pick b',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      correct: 'b',
      explanation: null,
    });
    const cloze = await createTypedCard(ctx, deck.id, {
      type: 'cloze',
      text: 'The {{answer}}.',
      accepted: [],
      hint: null,
      extra: null,
    });
    const session = await startSession(ctx, null, 'UTC');
    await rateCard(ctx, { cardId: basic.id, rating: 3, durationMs: 1 }); // remembered
    await rateCard(ctx, {
      cardId: mcq.id,
      rating: 1,
      durationMs: 1,
      outcome: { kind: 'mcq', selected: 'a', correct: false },
    }); // not
    await rateCard(ctx, {
      cardId: cloze.id,
      rating: 2,
      durationMs: 1,
      outcome: { kind: 'cloze', mode: 'typed', correct: true },
    }); // remembered
    await rateCard(ctx, { cardId: basic.id, rating: 1, durationMs: 1 }); // not
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: mcq.id, rating: 3, durationMs: 1 }); // undone below
    await undoLastReview(ctx, session.startedAt);
    expect(await sessionRecap(ctx, session)).toEqual({ reviewed: 4, remembered: 2, farOff: 0 });
  });

  it('farOff: cards from this session that won’t come back for 2+ weeks, from the scheduler', async () => {
    const ctx = await setup();
    const ids = await overdueCards(ctx, 3, 200 * DAY);
    const session = await startSession(ctx, null, 'UTC');
    for (const id of ids) await rateCard(ctx, { cardId: id, rating: 4, durationMs: 1 });
    const states = await ctx.db.cardStates.bulkGet(ids);
    const expected = states.filter((s) => s && s.due >= NOW + 14 * DAY).length;
    expect(expected).toBeGreaterThan(0);
    // One of them was then rated Again (in a later log): it's coming back soon.
    const last = ids[2];
    if (last === undefined) throw new Error('no card');
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: last, rating: 1, durationMs: 1 });
    const after = await ctx.db.cardStates.bulkGet(ids);
    const recap = await sessionRecap(ctx, session);
    expect(recap.farOff).toBe(after.filter((s) => s && s.due >= ctx.now() + 14 * DAY).length);
    expect(recap.farOff).toBeLessThan(3);
  });

  it('copy', () => {
    expect(rememberedLine(7, 8)).toBe('Remembered 7 of 8');
    expect(farOffLine(3)).toBe('3 cards won’t come back for 2+ weeks.');
    expect(farOffLine(1)).toBe('1 card won’t come back for 2+ weeks.');
    expect(farOffLine(0)).toBeNull();
    expect(nextDueLine({ kind: 'tomorrow', count: 9 })).toBe('Next: 9 due tomorrow');
    expect(nextDueLine({ kind: 'tomorrow', count: 1 })).toBe('Next: 1 due tomorrow');
    expect(nextDueLine({ kind: 'dueToday', count: 25 })).toBe('Next: 25 still due today');
    expect(nextDueLine({ kind: 'laterToday', count: 2 })).toBe('Next: 2 due later today');
    expect(nextDueLine({ kind: 'none' })).toBe('Next: nothing scheduled yet');
    expect(nextDueLine({ kind: 'later', day: '2026-10-15', count: 3 })).toMatch(
      /^Next: 3 due on Thu,? 15 Oct$/,
    );
  });

  it('loadNextDue: cards still in today’s queue are "still due today", not "later today"', async () => {
    const ctx = await setup();
    await overdueCards(ctx, 5);
    expect(await loadNextDue(ctx, opts)).toEqual({ kind: 'dueToday', count: 5 });
  });
});

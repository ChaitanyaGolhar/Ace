import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingActions } from '../src/services/pendingActions';

// The undo toast for deleting a card. Tombstones are sticky, so "undo" can't clear
// one: instead the tombstone write is delayed, and undo cancels the pending write.
describe('PendingActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the action after the delay', async () => {
    const pending = new PendingActions(5000);
    const commit = vi.fn(() => Promise.resolve());
    pending.schedule('card-1', commit);
    expect(pending.has('card-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(pending.has('card-1')).toBe(false);
  });

  it('undo cancels the action, so nothing is ever written', async () => {
    const pending = new PendingActions(5000);
    const commit = vi.fn(() => Promise.resolve());
    pending.schedule('card-1', commit);
    expect(pending.cancel('card-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commit).not.toHaveBeenCalled();
    expect(pending.cancel('card-1')).toBe(false);
  });

  it('flushAll runs every pending action immediately (e.g. when leaving the page)', async () => {
    const pending = new PendingActions(5000);
    const a = vi.fn(() => Promise.resolve());
    const b = vi.fn(() => Promise.resolve());
    pending.schedule('a', a);
    pending.schedule('b', b);
    await pending.flushAll();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('flush runs one pending action now (toast dismissed) and leaves the others', async () => {
    const pending = new PendingActions(5000);
    const a = vi.fn(() => Promise.resolve());
    const b = vi.fn(() => Promise.resolve());
    pending.schedule('a', a);
    pending.schedule('b', b);
    await pending.flush('a');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(pending.has('b')).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await pending.flush('missing');
  });

  it('notifies subscribers with the pending keys', () => {
    const pending = new PendingActions(5000);
    const seen: string[][] = [];
    const unsubscribe = pending.subscribe((keys) => seen.push([...keys]));
    pending.schedule('a', () => Promise.resolve());
    pending.cancel('a');
    unsubscribe();
    pending.schedule('b', () => Promise.resolve());
    expect(seen).toEqual([['a'], []]);
  });

  it('scheduling the same key twice keeps one pending action', async () => {
    const pending = new PendingActions(5000);
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    pending.schedule('a', first);
    pending.schedule('a', second);
    await vi.advanceTimersByTimeAsync(5000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

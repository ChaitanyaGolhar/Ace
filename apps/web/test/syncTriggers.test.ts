import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSyncTriggers, type TriggerEnvironment } from '../src/sync/triggers';

function fakeEnv() {
  const target = new EventTarget();
  const env: TriggerEnvironment & { visible: boolean; online: boolean; fire: (e: string) => void } =
    {
      visible: true,
      online: true,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      isVisible: () => env.visible,
      isOnline: () => env.online,
      fire: (name) => target.dispatchEvent(new Event(name)),
    };
  return env;
}

describe('sync triggers (§8.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs when the browser comes back online', () => {
    const env = fakeEnv();
    const sync = vi.fn();
    attachSyncTriggers(sync, env);
    env.fire('online');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('syncs every 60 s, but only while the tab is visible and online', () => {
    const env = fakeEnv();
    const sync = vi.fn();
    attachSyncTriggers(sync, env);
    vi.advanceTimersByTime(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    env.visible = false;
    vi.advanceTimersByTime(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    env.visible = true;
    env.online = false;
    vi.advanceTimersByTime(60_000);
    expect(sync).toHaveBeenCalledTimes(1);
    env.online = true;
    vi.advanceTimersByTime(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('syncs when the tab becomes visible again', () => {
    const env = fakeEnv();
    const sync = vi.fn();
    attachSyncTriggers(sync, env);
    env.visible = true;
    env.fire('visibilitychange');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('detach stops everything', () => {
    const env = fakeEnv();
    const sync = vi.fn();
    const detach = attachSyncTriggers(sync, env);
    detach();
    env.fire('online');
    vi.advanceTimersByTime(120_000);
    expect(sync).not.toHaveBeenCalled();
  });
});

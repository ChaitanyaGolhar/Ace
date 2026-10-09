import { SCHEDULER_VERSION } from '@recall/core';
import { getMeta, setMeta } from '../db/meta';
import type { AppContext } from './context';
import { rebuildAllCardStates } from './states';

export interface BootstrapOptions {
  /** `navigator.storage.persist` if the browser has it. */
  requestPersist: (() => Promise<boolean>) | undefined;
}

/** Runs once on every app start, before the UI reads any data. */
export async function initialize(ctx: AppContext, options: BootstrapOptions): Promise<void> {
  const { db } = ctx;

  if ((await getMeta(db, 'deviceId')) === undefined) {
    await setMeta(db, 'deviceId', ctx.newId());
  }

  // First launch only: ask the browser not to evict our IndexedDB data.
  if ((await getMeta(db, 'storagePersistence')) === undefined) {
    let result: 'granted' | 'denied' | 'unsupported' = 'unsupported';
    if (options.requestPersist) {
      try {
        result = (await options.requestPersist()) ? 'granted' : 'denied';
      } catch {
        result = 'denied';
      }
    }
    await setMeta(db, 'storagePersistence', result);
  }

  if ((await getMeta(db, 'schedulerVersion')) !== SCHEDULER_VERSION) {
    await rebuildAllCardStates(ctx);
    await setMeta(db, 'schedulerVersion', SCHEDULER_VERSION);
  }
}

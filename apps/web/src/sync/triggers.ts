/** The bits of the browser the triggers need (injectable for tests). */
export interface TriggerEnvironment {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  isVisible: () => boolean;
  isOnline: () => boolean;
}

const INTERVAL_MS = 60_000;

/**
 * Background sync triggers (§8.4): the `online` event, the tab becoming visible again,
 * and every 60 s while the tab is visible and online. App start, the end of a study
 * session and "Sync now" call the engine directly. Returns a function that detaches.
 */
export function attachSyncTriggers(sync: () => void, env: TriggerEnvironment): () => void {
  const onOnline = () => {
    sync();
  };
  const onVisibility = () => {
    if (env.isVisible() && env.isOnline()) sync();
  };
  env.addEventListener('online', onOnline);
  env.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => {
    if (env.isVisible() && env.isOnline()) sync();
  }, INTERVAL_MS);
  return () => {
    env.removeEventListener('online', onOnline);
    env.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
  };
}

/** The real browser environment. `visibilitychange` fires on document, `online` on window. */
export function browserTriggerEnvironment(): TriggerEnvironment {
  return {
    addEventListener: (type, listener) => {
      (type === 'visibilitychange' ? document : window).addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      (type === 'visibilitychange' ? document : window).removeEventListener(type, listener);
    },
    isVisible: () => document.visibilityState === 'visible',
    isOnline: () => navigator.onLine,
  };
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { v7 as uuidv7 } from 'uuid';
import { App, router } from './app/App';
import { ServicesProvider, type AppServices } from './app/services';
import { ToastProvider } from './app/toasts';
import { RecallDB } from './db/db';
import './index.css';
import { initialize } from './services/bootstrap';
import { checkForUpdates } from './services/catalog';
import { httpCatalogApi } from './services/catalogHttp';
import { httpEntitlementsApi, takeSignInReturn } from './services/entitlements';
import type { AppContext } from './services/context';
import { recordEvent } from './services/events';
import { PendingActions } from './services/pendingActions';
import { SyncEngine } from './sync/engine';
import { httpTransport } from './sync/transport';
import { attachSyncTriggers, browserTriggerEnvironment } from './sync/triggers';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root missing from index.html');
const root = createRoot(rootElement);

async function start() {
  // The real clock and real ids live here, at the edge. Services receive them.
  const ctx: AppContext = {
    db: new RecallDB(),
    now: () => Date.now(),
    newId: () => uuidv7(),
  };
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  await initialize(ctx, {
    requestPersist: typeof storage?.persist === 'function' ? () => storage.persist() : undefined,
  });
  // Analytics must never stop the app from starting (DECISIONS D-312).
  void recordEvent(ctx, 'app_opened', {}).catch(() => undefined);
  const sync = new SyncEngine({
    ctx,
    transport: httpTransport(API_URL, window.fetch.bind(window)),
    isOnline: () => navigator.onLine,
  });
  const catalog = httpCatalogApi(API_URL, window.fetch.bind(window));
  const services: AppServices = {
    ctx,
    browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pendingDeletes: new PendingActions(5000),
    sync,
    catalog,
    entitlements: httpEntitlementsApi(API_URL, window.fetch.bind(window)),
    isOnline: () => navigator.onLine,
  };

  // Coming back from a magic link (?signedIn=1): drop the flag and, if "Sign in to unlock"
  // sent the student, go back to that store page (M8, §8.4). Before the first render, so
  // the router starts there.
  const url = new URL(window.location.href);
  const justSignedIn = url.searchParams.get('signedIn') === '1';
  if (justSignedIn) {
    url.searchParams.delete('signedIn');
    const back = await takeSignInReturn(ctx).catch(() => null);
    // The router already read the location when it was created, so go through it.
    if (back) void router.navigate(back, { replace: true });
    else window.history.replaceState(null, '', url);
  }
  root.render(
    <StrictMode>
      <ServicesProvider services={services}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ServicesProvider>
    </StrictMode>,
  );

  // Sync never blocks the UI: it starts after the first render and runs in the background.
  // Coming back from a magic link (?signedIn=1) asks the API who is signed in; otherwise
  // the cached sign-in state decides (works offline).
  if (justSignedIn) {
    void sync.refreshAuth();
  } else {
    void sync.start();
  }
  attachSyncTriggers(() => void sync.requestSync(), browserTriggerEnvironment());

  // Catalog deck updates (M7, §7.6): checked at start, then at most every 12 hours
  // (checkForUpdates throttles; this just gives it chances). Never blocks anything.
  const checkUpdates = () => void checkForUpdates(ctx, catalog).catch(() => undefined);
  checkUpdates();
  setInterval(checkUpdates, 60 * 60 * 1000);
  window.addEventListener('online', checkUpdates);
}

root.render(
  <p role="status" style={{ padding: '1rem' }}>
    Loading…
  </p>,
);
start().catch(() => {
  root.render(
    <p role="alert" style={{ padding: '1rem' }}>
      This browser can’t store data for this app (IndexedDB is unavailable). Try another browser, or
      leave private browsing mode.
    </p>,
  );
});

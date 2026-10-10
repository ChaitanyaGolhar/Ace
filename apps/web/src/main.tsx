import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { v7 as uuidv7 } from 'uuid';
import { App } from './app/App';
import { ServicesProvider, type AppServices } from './app/services';
import { ToastProvider } from './app/toasts';
import { RecallDB } from './db/db';
import './index.css';
import { initialize } from './services/bootstrap';
import type { AppContext } from './services/context';
import { PendingActions } from './services/pendingActions';

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
  const services: AppServices = {
    ctx,
    browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pendingDeletes: new PendingActions(5000),
  };
  root.render(
    <StrictMode>
      <ServicesProvider services={services}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ServicesProvider>
    </StrictMode>,
  );
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

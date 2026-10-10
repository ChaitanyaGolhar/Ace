import { rmSync } from 'node:fs';
import { prepareDatabase } from '@recall/api/testing';
import { ADMIN_URL, E2E_DB_NAME, OUTBOX, startApi, stopApi } from './apiServer';

/** Fresh E2E database (migrated, emptied) and a running API on port 3100. */
export default async function globalSetup(): Promise<void> {
  await stopApi();
  rmSync(OUTBOX, { force: true });
  await prepareDatabase(ADMIN_URL, E2E_DB_NAME);
  await startApi();
}

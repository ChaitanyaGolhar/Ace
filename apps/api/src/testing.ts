// Test support for other packages (the web app's integration tests run the real API).
// Not used by the server itself.
import { execSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app';
import type { AppConfig } from './config';
import { createPrisma } from './db';
import type { Logger } from './logger';
import { MemoryMailer } from './mailer';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Creates `dbName` on the server in `adminUrl` if missing, migrates it, and empties it. */
export async function prepareDatabase(adminUrl: string, dbName: string): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`bad database name ${dbName}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  execSync('npx prisma migrate deploy', {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query(
      'TRUNCATE users, sessions, magic_link_tokens, decks, cards, review_logs, events, ' +
        'catalog_deck_version, catalog_deck CASCADE',
    );
  } finally {
    await db.end();
  }
  return url.toString();
}

export interface TestServer {
  url: string;
  mailer: MemoryMailer;
  close: () => Promise<void>;
}

/** Starts the real API on a random local port. */
export async function startTestServer(
  databaseUrl: string,
  options: { now?: () => number } = {},
): Promise<TestServer> {
  const prisma = createPrisma(databaseUrl);
  const mailer = new MemoryMailer();
  const config: AppConfig = {
    webOrigin: 'http://localhost:5173',
    apiOrigin: 'http://localhost:0',
    cookieSecure: true,
  };
  const quiet: Logger = { warn: () => undefined, error: () => undefined };
  const app = createApp({ prisma, config, mailer, logger: quiet, now: options.now ?? Date.now });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => {
      resolve(s);
    });
  });
  const url = `http://localhost:${String((server.address() as AddressInfo).port)}`;
  config.apiOrigin = url; // magic links point at this server
  return {
    url,
    mailer,
    close: async () => {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await prisma.$disconnect();
    },
  };
}

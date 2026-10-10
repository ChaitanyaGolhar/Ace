import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The real API for E2E tests, run as its own process so a test can kill it (M2:
// "studying is never blocked by sync errors — kill the API mid-session").

const HERE = dirname(fileURLToPath(import.meta.url));
export const TMP = join(HERE, '..', '.tmp');
export const API_DIR = join(HERE, '..', '..', '..', 'api');
export const API_PORT = 3100;
export const API_URL = `http://localhost:${String(API_PORT)}`;
export const WEB_ORIGIN = 'http://localhost:4173';
export const OUTBOX = join(TMP, 'outbox.jsonl');
const PID_FILE = join(TMP, 'api.pid');
/** The API's output, for diagnosing a failed run (e2e/.tmp is git-ignored). */
export const API_LOG = join(TMP, 'api.log');
export const E2E_DB_NAME = 'recall_e2e';
export const ADMIN_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? 'postgresql://recall:recall@localhost:54329/postgres';

export function e2eDatabaseUrl(): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${E2E_DB_NAME}`;
  return url.toString();
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function startApi(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  if (!existsSync(OUTBOX)) writeFileSync(OUTBOX, '');
  const log = openSync(API_LOG, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl(),
      PORT: String(API_PORT),
      WEB_ORIGIN,
      API_ORIGIN: API_URL,
      MAIL_MODE: 'file',
      MAIL_OUTBOX_FILE: OUTBOX,
      COOKIE_SECURE: 'true',
    },
    stdio: ['ignore', log, log],
    // Detached: when a test restarts the API (m2-sync), the new process must outlive that
    // test's worker; otherwise every later test loses the API (DEPLOY_LOG_M6, M7 report).
    detached: true,
    windowsHide: true,
  });
  if (child.pid === undefined) throw new Error('could not start the API');
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  if (!(await waitForHealth(30_000))) throw new Error('the API did not become healthy');
}

export async function stopApi(): Promise<void> {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
  rmSync(PID_FILE, { force: true });
  // Wait until the port stops answering.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${API_URL}/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The latest magic link sent to `email` (the API writes them to the outbox file). */
export async function magicLinkFor(email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const lines = readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean);
    const match = lines
      .map((l) => JSON.parse(l) as { email: string; link: string })
      .filter((m) => m.email === email)
      .at(-1);
    if (match) return match.link;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no magic link for ${email}`);
}

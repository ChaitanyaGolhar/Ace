import request from 'supertest';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';
import { createPrisma, type Prisma } from '../src/db';
import type { Logger } from '../src/logger';
import { MemoryMailer } from '../src/mailer';
import { TEST_DATABASE_URL } from './testDb';

export const WEB_ORIGIN = 'http://localhost:5173';
export const API_ORIGIN = 'http://localhost:3000';
/** 2026-10-10T10:00:00Z */
export const T0 = Date.UTC(2026, 9, 10, 10, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

let shared: Prisma | null = null;

/** One Prisma client for all tests in a file (Postgres connections are expensive). */
export function testPrisma(): Prisma {
  shared ??= createPrisma(TEST_DATABASE_URL);
  return shared;
}

export async function closeTestPrisma(): Promise<void> {
  await shared?.$disconnect();
  shared = null;
}

/** Empties every table (the sequence keeps counting; tests never depend on its value). */
export async function resetDb(prisma: Prisma = testPrisma()): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, sessions, magic_link_tokens, decks, cards, review_logs, events CASCADE',
  );
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  prisma: Prisma;
  mailer: MemoryMailer;
  warnings: string[];
  setNow: (t: number) => void;
  advance: (ms: number) => void;
  now: () => number;
}

export function makeTestApp(overrides: Partial<AppConfig> = {}): TestApp {
  let now = T0;
  const mailer = new MemoryMailer();
  const warnings: string[] = [];
  const logger: Logger = {
    warn: (message) => {
      warnings.push(message);
    },
    error: () => undefined,
  };
  const prisma = testPrisma();
  const config: AppConfig = {
    webOrigin: WEB_ORIGIN,
    apiOrigin: API_ORIGIN,
    cookieSecure: true,
    ...overrides,
  };
  const app = createApp({ prisma, config, mailer, logger, now: () => now });
  return {
    app,
    prisma,
    mailer,
    warnings,
    now: () => now,
    setNow: (t) => {
      now = t;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

/** Extracts the token from the last magic link sent to `email`. */
export function lastTokenFor(mailer: MemoryMailer, email: string): string {
  const link = mailer.sent.filter((m) => m.email === email).at(-1)?.link;
  if (!link) throw new Error(`no magic link sent to ${email}`);
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error('magic link has no token');
  return token;
}

/** Signs in through the real magic-link flow; returns the Cookie header value. */
export async function signIn(t: TestApp, email: string): Promise<string> {
  await request(t.app).post('/auth/magic-link').send({ email }).expect(202);
  const res = await request(t.app)
    .get('/auth/verify')
    .query({ token: lastTokenFor(t.mailer, email.trim().toLowerCase()) })
    .expect(303);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = setCookie?.find((c) => c.startsWith('recall_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0] ?? '';
}

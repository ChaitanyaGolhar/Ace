import { z } from 'zod';

/** What the app needs to know about where it runs. Secrets never live here, only in env. */
export interface AppConfig {
  /** Origin of the web app: the only CORS origin, and where /auth/verify redirects. */
  webOrigin: string;
  /** Public URL of this API, used to build magic links. */
  apiOrigin: string;
  /** Mark the session cookie Secure (on everywhere except plain-http setups). */
  cookieSecure: boolean;
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  API_ORIGIN: z.url().default('http://localhost:3000'),
  MAIL_MODE: z.enum(['console', 'file', 'resend']).default('console'),
  MAIL_OUTBOX_FILE: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('recall <login@example.com>'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  /** Set when running behind a reverse proxy, so rate limiting sees the real client IP. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.parse(env);
  if (parsed.MAIL_MODE === 'file' && !parsed.MAIL_OUTBOX_FILE) {
    throw new Error('MAIL_MODE=file needs MAIL_OUTBOX_FILE');
  }
  if (parsed.MAIL_MODE === 'resend' && !parsed.RESEND_API_KEY) {
    throw new Error('MAIL_MODE=resend needs RESEND_API_KEY');
  }
  return parsed;
}

export function configFromEnv(env: Env): AppConfig {
  return {
    webOrigin: env.WEB_ORIGIN.replace(/\/$/, ''),
    apiOrigin: env.API_ORIGIN.replace(/\/$/, ''),
    cookieSecure: env.COOKIE_SECURE === 'true',
  };
}

import { createApp } from './app';
import { configFromEnv, parseEnv } from './config';
import { createPrisma } from './db';
import { consoleLogger } from './logger';
import { ConsoleMailer, FileMailer, ResendMailer, type Mailer } from './mailer';

const env = parseEnv(process.env);
const prisma = createPrisma(env.DATABASE_URL);

let mailer: Mailer;
if (env.MAIL_MODE === 'resend') mailer = new ResendMailer(env.RESEND_API_KEY ?? '', env.MAIL_FROM);
else if (env.MAIL_MODE === 'file') mailer = new FileMailer(env.MAIL_OUTBOX_FILE ?? '');
else mailer = new ConsoleMailer();

const app = createApp({
  prisma,
  config: configFromEnv(env),
  mailer,
  logger: consoleLogger,
  now: () => Date.now(),
  trustProxy: env.TRUST_PROXY === 'true',
});

const server = app.listen(env.PORT, () => {
  consoleLogger.warn(
    `API listening on http://localhost:${String(env.PORT)} (mail: ${env.MAIL_MODE})`,
  );
});

function shutdown() {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

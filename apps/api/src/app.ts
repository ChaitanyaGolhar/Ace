import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { authRoutes } from './auth/routes';
import type { AppConfig } from './config';
import type { Prisma } from './db';
import { errorHandler, notFound } from './errors';
import type { Logger } from './logger';
import type { Mailer } from './mailer';
import { syncRoutes } from './sync/routes';

export interface AppDeps {
  prisma: Prisma;
  config: AppConfig;
  mailer: Mailer;
  logger: Logger;
  /** Current time (epoch ms). Injected so tests control expiry and clock clamping. */
  now: () => number;
  trustProxy?: boolean;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  if (deps.trustProxy) app.set('trust proxy', 1);

  // CORS: only the web app's origin, with cookies (§9.3). Other origins get no CORS
  // headers, so browsers block them.
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, origin === deps.config.webOrigin);
      },
      credentials: true,
    }),
  );
  // A full push (500 rows of up to 2×20,000 characters) can be large.
  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(authRoutes(deps));
  app.use(syncRoutes(deps));

  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}

import { PullQuerySchema, PushRequestSchema } from '@recall/core';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireUserId } from '../auth/session';
import { pullPage } from './pull';
import { applyPush } from './push';

/** Sync endpoints (§8). Both require a session; the user always comes from the session. */
export function syncRoutes({ prisma, now, logger }: AppDeps): Router {
  const router = Router();

  router.post('/sync/push', async (req, res) => {
    const userId = await requireUserId(prisma, req, now());
    const batch = PushRequestSchema.parse(req.body);
    res.json(await applyPush(prisma, userId, batch, now(), logger));
  });

  router.get('/sync/pull', async (req, res) => {
    const userId = await requireUserId(prisma, req, now());
    const query = PullQuerySchema.parse(req.query);
    res.json(await pullPage(prisma, userId, query));
  });

  return router;
}

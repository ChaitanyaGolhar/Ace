import { PROTOCOL_VERSION, PullQuerySchema, PushRequestSchema } from '@recall/core';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireUserId } from '../auth/session';
import { HttpError } from '../errors';
import { pullPage } from './pull';
import { applyPush } from './push';

/** Sync endpoints (§8). Both require a session; the user always comes from the session. */
export function syncRoutes({ prisma, now, logger }: AppDeps): Router {
  const router = Router();

  router.post('/sync/push', async (req, res) => {
    const userId = await requireUserId(prisma, req, now());
    rejectOldClients(req.body);
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

/**
 * §6.6: a client from before typed cards (no protocolVersion, or an older one) would
 * overwrite `type`/`content` through last-write-wins. Refuse it before reading anything,
 * so the client can tell its user to update. Pulls stay open to old clients.
 */
function rejectOldClients(body: unknown): void {
  const version =
    typeof body === 'object' && body !== null && 'protocolVersion' in body
      ? body.protocolVersion
      : undefined;
  if (typeof version !== 'number' || version < PROTOCOL_VERSION) {
    throw new HttpError(
      426,
      'upgrade_required',
      'This version of the app is out of date. Reload it to keep syncing.',
    );
  }
}

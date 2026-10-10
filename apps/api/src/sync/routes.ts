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
    rejectOldClients(protocolVersionOf(req.body));
    const batch = PushRequestSchema.parse(req.body);
    res.json(await applyPush(prisma, userId, batch, now(), logger));
  });

  router.get('/sync/pull', async (req, res) => {
    const userId = await requireUserId(prisma, req, now());
    rejectOldClients(protocolVersionOf(req.query, true));
    const query = PullQuerySchema.parse(req.query);
    res.json(await pullPage(prisma, userId, query));
  });

  return router;
}

/** The protocol version a request declares (query values are strings). */
function protocolVersionOf(source: unknown, fromQuery = false): number | undefined {
  if (typeof source !== 'object' || source === null || !('protocolVersion' in source)) {
    return undefined;
  }
  const v = source.protocolVersion;
  if (typeof v === 'number') return v;
  if (fromQuery && typeof v === 'string' && /^\d{1,3}$/.test(v)) return Number(v);
  return undefined;
}

/**
 * Old clients are refused before anything is read (426), so they can tell their user to
 * update. Since M6 (§6.6) for pushes: a client from before typed cards would overwrite
 * `type`/`content`. Since M7 also for pulls: an M6 app can't parse catalog decks, catalog
 * card ids or the new event types, and would later push catalog decks back without their
 * catalog fields. An M6 app shows "Update required to sync" for a 426 on either.
 */
function rejectOldClients(version: number | undefined): void {
  if (version === undefined || version < PROTOCOL_VERSION) {
    throw new HttpError(
      426,
      'upgrade_required',
      'This version of the app is out of date. Reload it to keep syncing.',
    );
  }
}

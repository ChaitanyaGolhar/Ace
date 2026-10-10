import { RedeemRequestSchema } from '@recall/core';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { RateLimiter } from '../auth/rateLimiter';
import { requireUserId } from '../auth/session';
import { HttpError } from '../errors';
import { entitlementsOf, redeemCode, RedeemError } from './redeem';

// Paid decks (BUILD_BRIEF_M6_M8 §8.2): redeeming unlock codes, the user's entitlements,
// and the owner's "How to buy" text.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export function paidRoutes({ prisma, config, logger, now }: AppDeps): Router {
  const router = Router();
  // Every attempt counts, successful or not (§8.2: 5 a minute per user, 20 an hour per IP).
  const perUser = new RateLimiter(5, MINUTE);
  const perIp = new RateLimiter(20, HOUR);

  router.post('/entitlements/redeem', async (req, res) => {
    const userId = await requireUserId(prisma, req, now());
    const ip = req.ip ?? 'unknown';
    const t = now();
    if (!perUser.allows(userId, t) || !perIp.allows(ip, t)) {
      logger.warn(`redeem rate-limited (user ${userId})`);
      throw new HttpError(429, 'rate_limited', 'Too many tries. Wait a minute and try again.');
    }
    perUser.record(userId, t);
    perIp.record(ip, t);
    const { code } = RedeemRequestSchema.parse(req.body);
    try {
      res.json({ slugs: await redeemCode(prisma, userId, code, t) });
    } catch (error) {
      // Logged without the code: only who, and why it failed.
      if (error instanceof RedeemError)
        logger.warn(`redeem failed: ${error.reason} (user ${userId})`);
      throw error;
    }
  });

  router.get('/entitlements', async (req, res) => {
    const userId = await requireUserId(prisma, req, now());
    res.json({ slugs: await entitlementsOf(prisma, userId) });
  });

  router.get('/purchase-info', (_req, res) => {
    res.set('Cache-Control', 'public, no-cache');
    res.json({ instructions: config.purchaseInstructions });
  });

  return router;
}

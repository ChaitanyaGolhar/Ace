import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { HttpError } from '../errors';
import { RateLimiter } from './rateLimiter';
import {
  clearSessionCookie,
  cookieToken,
  findSessionUser,
  SESSION_TTL_MS,
  setSessionCookie,
} from './session';
import { hashToken, newToken } from './tokens';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const MagicLinkBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});
const VerifyQuery = z.object({ token: z.string().min(1).max(200) });

export function authRoutes({ prisma, config, mailer, now }: AppDeps): Router {
  const router = Router();
  const perEmail = new RateLimiter(5, HOUR);
  const perIp = new RateLimiter(20, HOUR);

  router.post('/auth/magic-link', async (req, res) => {
    const { email } = MagicLinkBody.parse(req.body);
    const ip = req.ip ?? 'unknown';
    const t = now();
    if (!perEmail.allows(email, t) || !perIp.allows(ip, t)) {
      throw new HttpError(429, 'rate_limited', 'Too many sign-in requests. Try again later.');
    }
    perEmail.record(email, t);
    perIp.record(ip, t);

    const token = newToken();
    await prisma.magicLinkToken.create({
      data: { email, tokenHash: hashToken(token), expiresAt: new Date(t + MAGIC_LINK_TTL_MS) },
    });
    const link = `${config.apiOrigin}/auth/verify?token=${encodeURIComponent(token)}`;
    await mailer.sendMagicLink(email, link);
    // Same answer whether or not the email has an account.
    res.status(202).json({ ok: true });
  });

  router.get('/auth/verify', async (req, res) => {
    const parsed = VerifyQuery.safeParse(req.query);
    const fail = () => {
      res.redirect(303, `${config.webOrigin}/settings?signInError=invalid`);
    };
    if (!parsed.success) {
      fail();
      return;
    }
    const t = now();
    const sessionToken = newToken();
    const ok = await prisma.$transaction(async (tx) => {
      const row = await tx.magicLinkToken.findUnique({
        where: { tokenHash: hashToken(parsed.data.token) },
      });
      if (!row || row.usedAt !== null || row.expiresAt.getTime() <= t) return false;
      // Conditional update: if two requests race with the same token, only one wins.
      const consumed = await tx.magicLinkToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date(t) },
      });
      if (consumed.count !== 1) return false;
      const user = await tx.user.upsert({
        where: { email: row.email },
        create: { email: row.email },
        update: {},
      });
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(sessionToken),
          expiresAt: new Date(t + SESSION_TTL_MS),
        },
      });
      return true;
    });
    if (!ok) {
      fail();
      return;
    }
    setSessionCookie(res, sessionToken, config.cookieSecure);
    res.redirect(303, `${config.webOrigin}/settings?signedIn=1`);
  });

  router.post('/auth/logout', async (req, res) => {
    const token = cookieToken(req);
    if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    clearSessionCookie(res, config.cookieSecure);
    res.status(204).end();
  });

  router.get('/me', async (req, res) => {
    const user = await findSessionUser(prisma, req, now());
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');
    res.json({ id: user.id, email: user.email });
  });

  return router;
}

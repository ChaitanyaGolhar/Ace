import type { Request, Response } from 'express';
import type { Prisma } from '../db';
import { HttpError } from '../errors';
import { hashToken } from './tokens';

export const SESSION_COOKIE = 'recall_session';
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function cookieToken(req: Request): string | null {
  // cookie-parser fills req.cookies; it is typed `any` by @types/cookie-parser.
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The signed-in user for this request, or null. */
export async function findSessionUser(
  prisma: Prisma,
  req: Request,
  now: number,
): Promise<{ id: string; email: string; sessionId: string } | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= now) return null;
  return { id: session.user.id, email: session.user.email, sessionId: session.id };
}

/** The signed-in user's id; throws 401 otherwise. Routes never take a userId from the client. */
export async function requireUserId(prisma: Prisma, req: Request, now: number): Promise<string> {
  const user = await findSessionUser(prisma, req, now);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required');
  return user.id;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
}

export { cookieToken };

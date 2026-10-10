import { normalizeUnlockCode } from '@recall/core';
import type { Prisma } from '../db';
import { HttpError } from '../errors';
import { hashCode, sameHash } from './codes';

// Redeeming a code (BUILD_BRIEF_M6_M8 §8.2). One transaction with the code's row locked,
// so two simultaneous redemptions of a one-use code can't both succeed. Redeeming a code
// you already redeemed succeeds again without counting twice.

export type RedeemFailure = 'invalid' | 'used_up' | 'expired';

export class RedeemError extends HttpError {
  constructor(readonly reason: RedeemFailure) {
    const [status, message] =
      reason === 'used_up'
        ? [409, 'This code has already been used']
        : reason === 'expired'
          ? [410, 'This code has expired']
          : [400, 'This code isn’t valid'];
    super(status, reason === 'invalid' ? 'invalid_code' : reason, message);
  }
}

interface CodeRow {
  id: string;
  code_hash: string;
  slugs: string[];
  max_redemptions: number;
  redemption_count: number;
  expires_at: Date | null;
  disabled_at: Date | null;
}

/** Redeems `typed` for `userId`; returns the unlocked slugs, or throws RedeemError. */
export async function redeemCode(
  prisma: Prisma,
  userId: string,
  typed: string,
  now: number,
): Promise<string[]> {
  const normalized = normalizeUnlockCode(typed);
  if (normalized === null) throw new RedeemError('invalid');
  const hash = hashCode(normalized);
  return prisma.$transaction(async (tx) => {
    const [code] = await tx.$queryRaw<CodeRow[]>`
      SELECT id, code_hash, slugs, max_redemptions, redemption_count, expires_at, disabled_at
      FROM unlock_code WHERE code_hash = ${hash} FOR UPDATE`;
    if (!code || !sameHash(code.code_hash, hash) || code.disabled_at !== null) {
      throw new RedeemError('invalid');
    }
    const [already] = await tx.$queryRaw<{ code_id: string }[]>`
      SELECT code_id FROM unlock_redemption WHERE code_id = ${code.id} AND user_id = ${userId}`;
    if (!already) {
      if (code.expires_at !== null && code.expires_at.getTime() <= now) {
        throw new RedeemError('expired');
      }
      if (code.redemption_count >= code.max_redemptions) throw new RedeemError('used_up');
      await tx.$executeRaw`
        INSERT INTO unlock_redemption (code_id, user_id) VALUES (${code.id}, ${userId})`;
      await tx.$executeRaw`
        UPDATE unlock_code SET redemption_count = redemption_count + 1 WHERE id = ${code.id}`;
    }
    for (const slug of code.slugs) {
      await tx.$executeRaw`
        INSERT INTO entitlement (user_id, slug, source, code_id)
        VALUES (${userId}, ${slug}, 'code', ${code.id})
        ON CONFLICT (user_id, slug) DO NOTHING`;
    }
    return [...code.slugs].sort();
  });
}

export async function entitlementsOf(prisma: Prisma, userId: string): Promise<string[]> {
  const rows = await prisma.entitlement.findMany({ where: { userId }, orderBy: { slug: 'asc' } });
  return rows.map((r) => r.slug);
}

export async function hasEntitlement(
  prisma: Prisma,
  userId: string,
  slug: string,
): Promise<boolean> {
  return (
    (await prisma.entitlement.findUnique({ where: { userId_slug: { userId, slug } } })) !== null
  );
}

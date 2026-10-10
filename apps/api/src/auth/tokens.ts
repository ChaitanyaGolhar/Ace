import { createHash, randomBytes } from 'node:crypto';

/** A random 32-byte secret, URL-safe (43 characters). Used for magic links and sessions. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored only as SHA-256 hashes, so a database leak doesn't hand out working
 * sign-in links or sessions. (A plain hash is enough: the tokens are 256-bit random.)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

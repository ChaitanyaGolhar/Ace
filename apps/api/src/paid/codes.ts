import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { CROCKFORD_ALPHABET, UNLOCK_CODE_BYTES, unlockCodeFromBytes } from '@recall/core';

// Unlock codes on the server (BUILD_BRIEF_M6_M8 §8.1). Codes come from the CSPRNG and only
// their hash is stored. 50 bits is enough against online guessing (rate limits), but a
// fast hash of a leaked table could be brute-forced, so the hash is scrypt: deterministic
// (a fixed, public salt, so it can be looked up) and slow. No secret is needed (D-337).

/** Where random bytes come from: the CSPRNG, never a non-cryptographic generator. */
export const RANDOM_SOURCE: (size: number) => Buffer = randomBytes;

const SALT = 'ace-unlock-code-v1';
const SCRYPT = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** A new code, "ACE-XXXX-XXXX-XX". */
export function generateCode(random: (size: number) => Buffer = RANDOM_SOURCE): string {
  return unlockCodeFromBytes(random(UNLOCK_CODE_BYTES));
}

/** The stored form of a normalised code (64 hex characters). */
export function hashCode(normalized: string): string {
  return scryptSync(normalized, SALT, 32, SCRYPT).toString('hex');
}

/** Constant-time comparison of two stored hashes. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A short id for a code (8 Crockford characters), for `pnpm codes list` and `disable`. */
export function newCodeId(random: (size: number) => Buffer = RANDOM_SOURCE): string {
  const bytes = random(5);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let id = '';
  for (let i = 0; i < 8; i++)
    id += CROCKFORD_ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)] ?? '0';
  return id;
}

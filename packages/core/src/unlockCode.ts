import { z } from 'zod';
import { SlugSchema } from './schemas';

// Unlock codes for paid decks (BUILD_BRIEF_M6_M8 §8.1): "ACE-XXXX-XXXX-XX", Crockford
// base32 (no I, L, O, U), 50 bits. Core stays pure: the API supplies the random bytes from
// its CSPRNG (crypto.randomBytes); here they are only formatted and normalised.

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 10 base32 characters. */
export const UNLOCK_CODE_BITS = 50;
/** Random bytes a code is made from (56 bits; the first 50 are used). */
export const UNLOCK_CODE_BYTES = 7;
const BODY_LENGTH = UNLOCK_CODE_BITS / 5;

function format(body: string): string {
  return `ACE-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 10)}`;
}

/** A code from 7 random bytes (the first 50 bits). */
export function unlockCodeFromBytes(random: Uint8Array): string {
  if (random.length < UNLOCK_CODE_BYTES) {
    throw new RangeError(`an unlock code needs ${String(UNLOCK_CODE_BYTES)} random bytes`);
  }
  let bits = '';
  for (const byte of random.subarray(0, UNLOCK_CODE_BYTES))
    bits += byte.toString(2).padStart(8, '0');
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i++) {
    body += CROCKFORD_ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)] ?? '0';
  }
  return format(body);
}

/**
 * What a student typed → the canonical code, or null if it can't be one. Case, dashes
 * and spaces don't matter, the "ACE" prefix is optional, and Crockford's look-alikes are
 * read as intended (I, L → 1; O → 0).
 */
export function normalizeUnlockCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]+/g, '');
  if (s.startsWith('ACE') && s.length === BODY_LENGTH + 3) s = s.slice(3);
  s = s.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== BODY_LENGTH) return null;
  for (const ch of s) if (!CROCKFORD_ALPHABET.includes(ch)) return null;
  return format(s);
}

// API shapes (§8.2).
export const RedeemRequestSchema = z.object({ code: z.string().max(100) });
export const RedeemResponseSchema = z.object({ slugs: z.array(SlugSchema) });
export const EntitlementsResponseSchema = z.object({ slugs: z.array(SlugSchema) });
export type RedeemResponse = z.infer<typeof RedeemResponseSchema>;

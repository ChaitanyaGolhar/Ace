import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  EntitlementsResponseSchema,
  EventSchema,
  RedeemRequestSchema,
  RedeemResponseSchema,
  UNLOCK_CODE_BITS,
  unlockCodeFromBytes,
  normalizeUnlockCode,
} from '../src';

// M8 unlock codes (BUILD_BRIEF_M6_M8 §8.1): "ACE-XXXX-XXXX-XX", Crockford base32 (no I, L,
// O, U), at least 50 bits from a CSPRNG; matching ignores case, dashes and spaces. Core
// is pure: the API supplies the random bytes (crypto.randomBytes).

const bytes = (...b: number[]) => new Uint8Array(b);

describe('unlockCodeFromBytes', () => {
  it('formats 50 bits as ACE-XXXX-XXXX-XX in Crockford base32', () => {
    const code = unlockCodeFromBytes(bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff));
    expect(code).toBe('ACE-ZZZZ-ZZZZ-ZZ');
    expect(unlockCodeFromBytes(bytes(0, 0, 0, 0, 0, 0, 0))).toBe('ACE-0000-0000-00');
    expect(unlockCodeFromBytes(bytes(0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42))).toMatch(
      /^ACE-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/,
    );
  });

  it('uses at least 50 bits: every one of the first 50 input bits changes the code', () => {
    expect(UNLOCK_CODE_BITS).toBeGreaterThanOrEqual(50);
    const base = unlockCodeFromBytes(bytes(0, 0, 0, 0, 0, 0, 0));
    for (let bit = 0; bit < 50; bit++) {
      const b = new Uint8Array(7);
      b[Math.floor(bit / 8)] = 1 << (7 - (bit % 8));
      expect(unlockCodeFromBytes(b), `bit ${String(bit)}`).not.toBe(base);
    }
  });

  it('never uses I, L, O or U', () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/);
    for (let v = 0; v < 256; v += 7) {
      expect(unlockCodeFromBytes(bytes(v, 255 - v, v, 255 - v, v, 255 - v, v))).not.toMatch(
        /[ILOU]/,
      );
    }
  });

  it('needs 7 random bytes', () => {
    expect(() => unlockCodeFromBytes(bytes(1, 2, 3))).toThrow(RangeError);
  });
});

describe('normalizeUnlockCode (what a student types)', () => {
  const code = 'ACE-7K3M-9QXR-2B';
  it('ignores case, dashes and spaces; the ACE prefix is optional', () => {
    for (const typed of [
      code,
      'ace-7k3m-9qxr-2b',
      ' ACE 7K3M 9QXR 2B ',
      'ACE7K3M9QXR2B',
      '7K3M-9QXR-2B',
      'ace—7k3m–9qxr—2b'.replace(/[—–]/g, '-'),
    ]) {
      expect(normalizeUnlockCode(typed), typed).toBe(code);
    }
  });

  it('reads the look-alikes Crockford allows (I, L → 1; O → 0)', () => {
    expect(normalizeUnlockCode('ACE-7K3M-9QXR-2B'.replace('2', 'I').replace('9', 'O'))).toBe(
      'ACE-7K3M-0QXR-1B',
    );
  });

  // A well-formed code that doesn't exist (any 10 alphabet characters) is the server's
  // "This code isn't valid"; here only what can't be a code at all is rejected.
  it('rejects anything that can’t be a code', () => {
    for (const bad of [
      '',
      'ACE',
      'ACE-7K3M-9QXR',
      'ACE-7K3M-9QXR-2B-X',
      'ACE-7K3M-9QXR-2U',
      'hello wörld',
      'ACE-7K3M-9QXR-2!',
    ]) {
      expect(normalizeUnlockCode(bad), bad).toBeNull();
    }
  });
});

describe('API shapes and M8 events', () => {
  it('redeem request, redeem response, entitlements', () => {
    expect(RedeemRequestSchema.parse({ code: ' ace-7k3m-9qxr-2b ' })).toEqual({
      code: ' ace-7k3m-9qxr-2b ',
    });
    expect(RedeemRequestSchema.safeParse({ code: 'x'.repeat(200) }).success).toBe(false);
    expect(RedeemResponseSchema.parse({ slugs: ['sppu-te-aids-ml'] }).slugs).toEqual([
      'sppu-te-aids-ml',
    ]);
    expect(EntitlementsResponseSchema.parse({ slugs: [] }).slugs).toEqual([]);
  });

  it('events carry slugs and a reason, never the code', () => {
    const base = { id: '01920000-0000-7000-8000-000000000001', occurredAt: 1, deviceId: 'd' };
    const ok = [
      { type: 'purchase_info_viewed', props: { slug: 'sppu-te-aids-ml' } },
      { type: 'code_redeemed', props: { slugs: ['a', 'b-c'] } },
      { type: 'code_redeem_failed', props: { reason: 'invalid' } },
      { type: 'code_redeem_failed', props: { reason: 'used_up' } },
      { type: 'code_redeem_failed', props: { reason: 'expired' } },
      { type: 'code_redeem_failed', props: { reason: 'rate_limited' } },
      { type: 'code_redeem_failed', props: { reason: 'network' } },
    ];
    for (const e of ok)
      expect(EventSchema.safeParse({ ...base, ...e }).success, JSON.stringify(e)).toBe(true);
    for (const bad of [
      { type: 'code_redeemed', props: { slugs: ['a'], code: 'ACE-7K3M-9QXR-2B' } },
      { type: 'code_redeem_failed', props: { reason: 'ACE-7K3M-9QXR-2B' } },
      { type: 'code_redeemed', props: { slugs: ['ACE 7K3M 9QXR 2B'] } },
    ]) {
      expect(EventSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

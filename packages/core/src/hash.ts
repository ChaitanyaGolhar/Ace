import { canonicalJson } from './merge';
import type { CardContent } from './content';

// M7 (BUILD_BRIEF_M6_M8 §7.5–7.6): hashing for catalog decks. Core stays pure (no
// `crypto`), so SHA-1 is implemented here (FIPS 180-4). It identifies content; it is not
// used for security.

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

function sha1Bytes(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  // Pad: 0x80, zeros, then the 64-bit length, to a multiple of 64 bytes.
  const padded = new Uint8Array(Math.ceil((message.length + 9) / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => {
    outView.setUint32(i * 4, h);
  });
  return out;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-1 of the UTF-8 encoding of `text`, as 40 lower-case hex characters. */
export function sha1Hex(text: string): string {
  return hex(sha1Bytes(new TextEncoder().encode(text)));
}

/** RFC 4122 version-5 (SHA-1, name-based) UUID of `name` in `namespace`. */
export function uuidV5(name: string, namespace: string): string {
  const ns = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(ns)) throw new RangeError(`bad namespace UUID: ${namespace}`);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  for (let i = 0; i < 16; i++) input[i] = parseInt(ns.slice(i * 2, i * 2 + 2), 16);
  input.set(nameBytes, 16);
  const bytes = sha1Bytes(input).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The id of a catalog card in a student's copy (§7.5): derived from the local deck id and
 * the card's key, so every device that adds or updates the same deck makes the same ids.
 */
export function catalogCardId(deckId: string, sourceKey: string): string {
  return uuidV5(sourceKey, deckId);
}

/** Identifies a card's content, whatever the key order (jsonb reorders keys). */
export function contentHash(content: CardContent): string {
  return sha1Hex(canonicalJson(content));
}

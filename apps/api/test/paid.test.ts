import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { publishVersion } from '../src/catalog/store';
import type { CliIO } from '../src/catalog/cli';
import { runCodesCli, runSalesCli } from '../src/paid/cli';
import { generateCode, hashCode, RANDOM_SOURCE } from '../src/paid/codes';
import {
  closeTestPrisma,
  DAY,
  makeTestApp,
  MINUTE,
  resetDb,
  signIn,
  testPrisma,
  type TestApp,
} from './helpers';
import { deckFile } from './catalogFixtures';

// Paid decks (BUILD_BRIEF_M6_M8 §8.1–8.3, §8.5): unlock codes, redemption, entitlements,
// rate limits, access to paid content, and the owner's CLI.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

const prisma = testPrisma();
const PAID = 'sppu-te-aids-ml';
const PAID_2 = 'sppu-te-aids-dl';

async function seedPaid() {
  await publishVersion(prisma, deckFile({ slug: PAID, price: 4900 }));
  await publishVersion(prisma, deckFile({ slug: PAID_2, price: 9900 }));
  await publishVersion(prisma, deckFile({ slug: 'free-deck' }));
}

/** Runs `pnpm codes …` against the test DB; returns its output lines and the codes printed. */
async function codes(args: string[], now = Date.now()) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    confirm: () => Promise.resolve(true),
    readFile: () => '',
    prisma: () => prisma,
    target: 'test database',
  };
  const code = await runCodesCli(args, io, now);
  return {
    code,
    out,
    err: err.join('\n'),
    printed: out.filter((l) => /^ACE-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/.test(l)),
  };
}

const redeem = (t: TestApp, cookie: string, code: string) =>
  request(t.app).post('/entitlements/redeem').set('Cookie', cookie).send({ code });

describe('code generation', () => {
  it('format: ACE-XXXX-XXXX-XX in Crockford base32', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(
        /^ACE-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/,
      );
    }
  });

  it('the entropy source is the CSPRNG (crypto.randomBytes), never Math.random', () => {
    expect(RANDOM_SOURCE).toBe(randomBytes);
    const src = join(import.meta.dirname, '..', 'src', 'paid');
    for (const file of readdirSync(src)) {
      expect(readFileSync(join(src, file), 'utf8'), file).not.toMatch(/Math\.random/);
    }
    // 2,000 codes, no duplicates.
    expect(new Set(Array.from({ length: 2000 }, () => generateCode())).size).toBe(2000);
  });

  it('hashes are deterministic, and differ per code', () => {
    expect(hashCode('ACE-7K3M-9QXR-2B')).toBe(hashCode('ACE-7K3M-9QXR-2B'));
    expect(hashCode('ACE-7K3M-9QXR-2B')).not.toBe(hashCode('ACE-7K3M-9QXR-2C'));
    expect(hashCode('ACE-7K3M-9QXR-2B')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /entitlements/redeem', () => {
  it('valid: unlocks the deck (also typed in lower case with spaces); GET /entitlements lists it', async () => {
    await seedPaid();
    const [code] = (await codes(['create', '--deck', PAID, '--count', '1', '--note', 'test']))
      .printed;
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const typed = (code ?? '').toLowerCase().replace(/-/g, ' ');
    const res = await redeem(t, cookie, typed).expect(200);
    expect(res.body).toEqual({ slugs: [PAID] });
    expect(
      (await request(t.app).get('/entitlements').set('Cookie', cookie).expect(200)).body,
    ).toEqual({
      slugs: [PAID],
    });
  });

  it('invalid (unknown code, or not a code at all): "This code isn’t valid"', async () => {
    await seedPaid();
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    for (const bad of ['ACE-0000-0000-00', 'hello', '']) {
      const res = await redeem(t, cookie, bad).expect(400);
      expect(res.body).toEqual({
        error: { code: 'invalid_code', message: 'This code isn’t valid' },
      });
    }
  });

  it('expired: "This code has expired"', async () => {
    await seedPaid();
    const t = makeTestApp();
    const created = await codes(
      ['create', '--deck', PAID, '--count', '1', '--expires', '2026-10-12', '--note', 'n'],
      t.now(),
    );
    const cookie = await signIn(t, 'a@example.com');
    t.advance(5 * DAY);
    const res = await redeem(t, cookie, created.printed[0] ?? '').expect(410);
    expect((res.body as { error: unknown }).error).toEqual({
      code: 'expired',
      message: 'This code has expired',
    });
  });

  it('disabled: treated as not valid', async () => {
    await seedPaid();
    const created = await codes(['create', '--deck', PAID, '--count', '1', '--note', 'n']);
    const row = await prisma.unlockCode.findFirst();
    expect((await codes(['disable', row?.id ?? ''])).code).toBe(0);
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    await redeem(t, cookie, created.printed[0] ?? '').expect(400);
  });

  it('used up: "This code has already been used"; re-redeeming your own code is idempotent', async () => {
    await seedPaid();
    const [code = ''] = (await codes(['create', '--deck', PAID, '--count', '1', '--note', 'n']))
      .printed;
    const t = makeTestApp();
    const a = await signIn(t, 'a@example.com');
    const b = await signIn(t, 'b@example.com');
    await redeem(t, a, code).expect(200);
    await redeem(t, a, code).expect(200); // idempotent
    expect((await prisma.unlockCode.findFirst())?.redemptionCount).toBe(1);
    const res = await redeem(t, b, code).expect(409);
    expect((res.body as { error: unknown }).error).toEqual({
      code: 'used_up',
      message: 'This code has already been used',
    });
  });

  it('a multi-deck code unlocks every deck; --max-uses lets several people redeem it', async () => {
    await seedPaid();
    const [code = ''] = (
      await codes([
        'create',
        '--deck',
        PAID,
        '--deck',
        PAID_2,
        '--count',
        '1',
        '--max-uses',
        '2',
        '--note',
        'bundle',
      ])
    ).printed;
    const t = makeTestApp();
    const a = await signIn(t, 'a@example.com');
    const b = await signIn(t, 'b@example.com');
    const c = await signIn(t, 'c@example.com');
    expect((await redeem(t, a, code).expect(200)).body).toEqual({ slugs: [PAID_2, PAID].sort() });
    await redeem(t, b, code).expect(200);
    await redeem(t, c, code).expect(409);
  });

  it('concurrency: 10 parallel redemptions of a one-use code by 10 people → exactly one succeeds', async () => {
    await seedPaid();
    const [code = ''] = (await codes(['create', '--deck', PAID, '--count', '1', '--note', 'race']))
      .printed;
    const t = makeTestApp();
    const cookies = [];
    for (let i = 0; i < 10; i++) cookies.push(await signIn(t, `racer${String(i)}@example.com`));
    const results = await Promise.all(cookies.map((cookie) => redeem(t, cookie, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect((await prisma.unlockCode.findFirst())?.redemptionCount).toBe(1);
    expect(await prisma.entitlement.count()).toBe(1);
  });

  it('needs a session (401)', async () => {
    const t = makeTestApp();
    await request(t.app)
      .post('/entitlements/redeem')
      .send({ code: 'ACE-0000-0000-00' })
      .expect(401);
    await request(t.app).get('/entitlements').expect(401);
  });
});

describe('rate limits', () => {
  it('5 attempts a minute per user; the 6th is refused, and allowed again after a minute', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    for (let i = 0; i < 5; i++) await redeem(t, cookie, 'ACE-0000-0000-00').expect(400);
    const res = await redeem(t, cookie, 'ACE-0000-0000-00').expect(429);
    expect((res.body as { error: { code: string } }).error.code).toBe('rate_limited');
    t.advance(MINUTE + 1);
    await redeem(t, cookie, 'ACE-0000-0000-00').expect(400);
  });

  it('20 attempts an hour per IP, across users', async () => {
    const t = makeTestApp();
    const cookies = [];
    for (let i = 0; i < 5; i++) cookies.push(await signIn(t, `u${String(i)}@example.com`));
    for (let i = 0; i < 20; i++) {
      await redeem(t, cookies[i % 5] ?? '', 'ACE-0000-0000-00').expect(400);
    }
    await redeem(t, cookies[0] ?? '', 'ACE-0000-0000-00').expect(429);
  });
});

describe('access to paid content (§8.2)', () => {
  it('a paid version: 403 signed out, 403 without the entitlement, 200 with it (updates too)', async () => {
    await seedPaid();
    await publishVersion(prisma, deckFile({ slug: PAID, price: 4900, version: 2 }));
    const t = makeTestApp();
    await request(t.app).get(`/catalog/${PAID}/versions/1`).expect(403);
    const cookie = await signIn(t, 'a@example.com');
    await request(t.app).get(`/catalog/${PAID}/versions/1`).set('Cookie', cookie).expect(403);
    const [code = ''] = (await codes(['create', '--deck', PAID, '--count', '1', '--note', 'n']))
      .printed;
    await redeem(t, cookie, code).expect(200);
    const v1 = await request(t.app)
      .get(`/catalog/${PAID}/versions/1`)
      .set('Cookie', cookie)
      .expect(200);
    expect(v1.headers['cache-control']).toMatch(/^private/);
    await request(t.app).get(`/catalog/${PAID}/versions/2`).set('Cookie', cookie).expect(200);
    // Another paid deck stays locked.
    await request(t.app).get(`/catalog/${PAID_2}/versions/1`).set('Cookie', cookie).expect(403);
  });

  it('a free deck needs no session', async () => {
    await seedPaid();
    const t = makeTestApp();
    await request(t.app).get('/catalog/free-deck/versions/1').expect(200);
  });

  it('GET /purchase-info: the owner’s text (from config), no session needed', async () => {
    const t = makeTestApp();
    const res = await request(t.app).get('/purchase-info').expect(200);
    expect(res.body).toEqual({
      instructions: 'Pay ₹49 by UPI to owner@upi.\nThen message +91 90000 00000 on WhatsApp.',
    });
  });
});

describe('no plaintext codes in the database or the logs (§8.5)', () => {
  it('after creating, redeeming (ok and failed) and listing codes', async () => {
    await seedPaid();
    const created = await codes(['create', '--deck', PAID, '--count', '3', '--note', 'scan']);
    const t = makeTestApp();
    const a = await signIn(t, 'a@example.com');
    const b = await signIn(t, 'b@example.com');
    const [first = '', second = ''] = created.printed;
    await redeem(t, a, first).expect(200);
    await redeem(t, b, first).expect(409);
    await redeem(t, b, second.toLowerCase()).expect(200);
    await redeem(t, b, 'ACE-ZZZZ-ZZZZ-ZZ').expect(400);
    const listed = await codes(['list']);

    const tables = [
      'unlock_code',
      'unlock_redemption',
      'entitlement',
      'events',
      'users',
      'sessions',
    ];
    let everything = '';
    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT row_to_json(x)::text AS j FROM ${table} x`,
      );
      everything += JSON.stringify(rows);
    }
    const logs = t.warnings.join('\n');
    expect(logs).toMatch(/redeem failed: used_up/); // failures are logged…
    for (const code of [...created.printed, 'ACE-ZZZZ-ZZZZ-ZZ']) {
      const body = code.slice(4).replace(/-/g, '');
      for (const form of [code, code.toLowerCase(), body]) {
        expect(everything, `DB contains ${form}`).not.toContain(form);
        expect(logs, `logs contain ${form}`).not.toContain(form); // …without the code
        expect(listed.out.join('\n'), `list shows ${form}`).not.toContain(form);
      }
    }
  });
});

describe('pnpm codes / pnpm sales', () => {
  it('create prints the codes once, then only hashes are stored', async () => {
    await seedPaid();
    const r = await codes(['create', '--deck', PAID, '--count', '3', '--note', 'UPI 11 Oct Rahul']);
    expect(r.code).toBe(0);
    expect(r.printed).toHaveLength(3);
    expect(new Set(r.printed).size).toBe(3);
    expect(r.out.join('\n')).toMatch(/shown only this once/);
    const rows = await prisma.unlockCode.findMany();
    expect(rows.map((x) => x.codeHash).sort()).toEqual(r.printed.map(hashCode).sort());
    expect(rows.every((x) => x.note === 'UPI 11 Oct Rahul' && x.maxRedemptions === 1)).toBe(true);
  });

  it('create refuses unknown decks, bad counts, past dates and a missing note', async () => {
    await seedPaid();
    expect((await codes(['create', '--deck', 'nope', '--count', '1', '--note', 'n'])).err).toMatch(
      /No such deck/,
    );
    expect((await codes(['create', '--deck', PAID, '--count', '0', '--note', 'n'])).err).toMatch(
      /--count/,
    );
    expect(
      (
        await codes([
          'create',
          '--deck',
          PAID,
          '--count',
          '1',
          '--expires',
          '2020-01-01',
          '--note',
          'n',
        ])
      ).err,
    ).toMatch(/past/);
    expect((await codes(['create', '--deck', PAID, '--count', '1'])).err).toMatch(/--note/);
    expect(await prisma.unlockCode.count()).toBe(0);
  });

  it('list shows id, status, uses, decks and note, never the code; --deck filters', async () => {
    await seedPaid();
    await codes(['create', '--deck', PAID, '--count', '1', '--note', 'first']);
    await codes(['create', '--deck', PAID_2, '--count', '1', '--note', 'second']);
    const all = await codes(['list']);
    expect(all.out).toHaveLength(2);
    expect(all.out[0]).toMatch(
      /^[0-9A-Z]{8} +active +0\/1 used +sppu-te-aids-ml +no expiry +first$/,
    );
    expect((await codes(['list', '--deck', PAID_2])).out.join('\n')).toMatch(/second/);
    expect((await codes(['list', '--deck', PAID_2])).out.join('\n')).not.toMatch(/first/);
  });

  it('disable, and sales per deck per day', async () => {
    await seedPaid();
    const [code = ''] = (await codes(['create', '--deck', PAID, '--count', '1', '--note', 'n']))
      .printed;
    const t = makeTestApp();
    await redeem(t, await signIn(t, 'a@example.com'), code).expect(200);
    const out: string[] = [];
    const io: CliIO = {
      out: (l) => out.push(l),
      err: () => undefined,
      confirm: () => Promise.resolve(true),
      readFile: () => '',
      prisma: () => prisma,
      target: 'test',
    };
    expect(await runSalesCli(io)).toBe(0);
    expect(out).toEqual([expect.stringMatching(new RegExp(`^\\d{4}-\\d{2}-\\d{2}  ${PAID}  1$`))]);
    const id = (await prisma.unlockCode.findFirst())?.id ?? '';
    expect((await codes(['disable', id.toLowerCase()])).out.join('')).toMatch(/is disabled/);
    expect((await codes(['disable', id])).err).toMatch(/already disabled/);
    expect((await codes(['list'])).out.join('')).toMatch(/disabled/);
  });
});

import { SlugSchema } from '@recall/core';
import type { CliIO } from '../catalog/cli';
import type { Prisma } from '../db';
import { generateCode, hashCode, newCodeId, RANDOM_SOURCE } from './codes';

// The owner's code and sales CLIs (BUILD_BRIEF_M6_M8 §8.3):
//   pnpm codes create --deck <slug> [--deck <slug2>] --count N [--max-uses 1]
//                     [--expires 2026-12-31] --note "…"
//   pnpm codes list [--deck <slug>]
//   pnpm codes disable <id>
//   pnpm sales
// Plaintext codes are printed once, at creation, and never stored.

const CODES_USAGE = `Usage: pnpm codes <command>
  create --deck <slug> [--deck <slug2>] --count N [--max-uses 1] [--expires YYYY-MM-DD] --note "…"
  list [--deck <slug>]
  disable <id>`;

export const MAX_CODES_PER_RUN = 1000;

interface Options {
  decks: string[];
  values: Map<string, string>;
  positional: string[];
}

function parseArgs(args: string[]): Options {
  const decks: string[] = [];
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a.startsWith('--')) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        values.set(a, '');
        continue;
      }
      if (a === '--deck') decks.push(value);
      else values.set(a, value);
      i += 1;
    } else {
      positional.push(a);
    }
  }
  return { decks, values, positional };
}

function status(
  row: {
    disabledAt: Date | null;
    expiresAt: Date | null;
    redemptionCount: number;
    maxRedemptions: number;
  },
  now: number,
): string {
  if (row.disabledAt) return 'disabled';
  if (row.expiresAt && row.expiresAt.getTime() <= now) return 'expired';
  if (row.redemptionCount >= row.maxRedemptions) return 'used up';
  return 'active';
}

async function create(prisma: Prisma, o: Options, io: CliIO, now: number): Promise<number> {
  const fail = (message: string) => {
    io.err(message);
    io.err(CODES_USAGE);
    return 1;
  };
  if (o.decks.length === 0) return fail('Give at least one --deck <slug>.');
  for (const slug of o.decks) {
    if (!SlugSchema.safeParse(slug).success) return fail(`Not a deck slug: ${slug}`);
  }
  const known = await prisma.catalogDeck.findMany({ where: { slug: { in: o.decks } } });
  const missing = o.decks.filter((s) => !known.some((k) => k.slug === s));
  if (missing.length > 0) return fail(`No such deck in the catalog: ${missing.join(', ')}`);
  const count = Number(o.values.get('--count'));
  if (!Number.isInteger(count) || count < 1 || count > MAX_CODES_PER_RUN) {
    return fail(`--count must be a whole number from 1 to ${String(MAX_CODES_PER_RUN)}.`);
  }
  const maxUses = o.values.has('--max-uses') ? Number(o.values.get('--max-uses')) : 1;
  if (!Number.isInteger(maxUses) || maxUses < 1)
    return fail('--max-uses must be a whole number, at least 1.');
  let expiresAt: Date | null = null;
  const expires = o.values.get('--expires');
  if (expires !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(`${expires}T00:00:00Z`))) {
      return fail('--expires must be a date written as YYYY-MM-DD.');
    }
    // The code works through that whole day (India time), then expires.
    expiresAt = new Date(Date.parse(`${expires}T23:59:59.999+05:30`));
    if (expiresAt.getTime() <= now) return fail('--expires is in the past.');
  }
  const note = o.values.get('--note') ?? '';
  if (note.trim() === '')
    return fail('Give a --note (e.g. "UPI 11 Oct Rahul"), so you know what each code was for.');
  const slugs = [...new Set(o.decks)].sort();

  const codes: string[] = [];
  const rows: { id: string; codeHash: string }[] = [];
  const hashes = new Set<string>();
  while (codes.length < count) {
    const code = generateCode(RANDOM_SOURCE);
    const hash = hashCode(code);
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    codes.push(code);
    rows.push({ id: newCodeId(RANDOM_SOURCE), codeHash: hash });
  }
  // A collision with an existing code is astronomically unlikely; the unique index refuses it.
  await prisma.$transaction(
    rows.map((r) =>
      prisma.unlockCode.create({
        data: { ...r, slugs, maxRedemptions: maxUses, expiresAt, note: note.trim() },
      }),
    ),
  );
  io.out(
    `${String(count)} ${count === 1 ? 'code' : 'codes'} for ${slugs.join(' + ')}` +
      ` (${String(maxUses)} ${maxUses === 1 ? 'use' : 'uses'} each${expires ? `, until ${expires}` : ''}),` +
      ` in ${io.target} (they work only there):`,
  );
  for (const code of codes) io.out(code);
  io.out('Copy them now: they are shown only this once and stored only as hashes.');
  return 0;
}

async function list(prisma: Prisma, o: Options, io: CliIO, now: number): Promise<number> {
  const deck = o.decks[0];
  const rows = await prisma.unlockCode.findMany({
    where: deck ? { slugs: { has: deck } } : {},
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) io.out('No codes yet.');
  for (const r of rows) {
    io.out(
      [
        r.id,
        status(r, now).padEnd(8),
        `${String(r.redemptionCount)}/${String(r.maxRedemptions)} used`,
        r.slugs.join('+'),
        r.expiresAt ? `until ${r.expiresAt.toISOString().slice(0, 10)}` : 'no expiry',
        r.note,
      ].join('  '),
    );
  }
  return 0;
}

async function disable(prisma: Prisma, o: Options, io: CliIO): Promise<number> {
  const id = (o.positional[0] ?? '').toUpperCase();
  if (!id) {
    io.err(CODES_USAGE);
    return 2;
  }
  const changed = await prisma.unlockCode.updateMany({
    where: { id, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  if (changed.count === 0) {
    const exists = await prisma.unlockCode.findUnique({ where: { id } });
    io.err(exists ? `Code ${id} is already disabled.` : `No code with id ${id}.`);
    return 1;
  }
  io.out(`Code ${id} is disabled. Decks already unlocked with it stay unlocked.`);
  return 0;
}

export async function runCodesCli(argv: string[], io: CliIO, now = Date.now()): Promise<number> {
  const [command, ...rest] = argv;
  const o = parseArgs(rest);
  switch (command) {
    case 'create':
      return create(io.prisma(), o, io, now);
    case 'list':
      return list(io.prisma(), o, io, now);
    case 'disable':
      return disable(io.prisma(), o, io);
    default:
      io.err(CODES_USAGE);
      return 2;
  }
}

/** `pnpm sales`: redemptions per deck per day (India time). */
export async function runSalesCli(io: CliIO): Promise<number> {
  const rows = await io.prisma().$queryRaw<{ day: string; slug: string; redemptions: number }[]>`
    SELECT to_char(r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
           s.slug, COUNT(*)::int AS redemptions
    FROM unlock_redemption r
    JOIN unlock_code c ON c.id = r.code_id
    CROSS JOIN LATERAL unnest(c.slugs) AS s(slug)
    GROUP BY 1, 2
    ORDER BY 1, 2`;
  if (rows.length === 0) {
    io.out('No redemptions yet.');
    return 0;
  }
  for (const r of rows) io.out(`${r.day}  ${r.slug}  ${String(r.redemptions)}`);
  return 0;
}

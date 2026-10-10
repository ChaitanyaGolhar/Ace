// `pnpm deck …` (BUILD_BRIEF_M6_M8 §7.4): the owner's publishing CLI. Run it from the repo
// root. It uses DATABASE_URL from the environment, or apps/api/.env if that isn't set.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { runDeckCli } from '../src/catalog/cli';
import { createPrisma, type Prisma } from '../src/db';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(join(API_DIR, '.env'));
  } catch {
    // No .env: DATABASE_URL must come from the environment.
  }
}

function describeTarget(url: string | undefined): string {
  if (!url) return '(DATABASE_URL is not set)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

const db: { prisma: Prisma | null } = { prisma: null };
const code = await runDeckCli(process.argv.slice(2), {
  out: (line) => {
    process.stdout.write(`${line}
`);
  },
  err: (line) => {
    process.stderr.write(`${line}
`);
  },
  confirm: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`${question} [y/N] `);
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
  },
  // pnpm runs scripts in apps/api; paths are relative to where `pnpm deck` was typed.
  readFile: (path) => readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), path), 'utf8'),
  prisma: () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    db.prisma ??= createPrisma(url);
    return db.prisma;
  },
  target: describeTarget(process.env.DATABASE_URL),
});
await db.prisma?.$disconnect();
process.exitCode = code;

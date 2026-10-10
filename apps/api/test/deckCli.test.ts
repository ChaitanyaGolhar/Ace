import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runDeckCli, type CliIO } from '../src/catalog/cli';
import { closeTestPrisma, makeTestApp, resetDb, testPrisma } from './helpers';
import { basic, rawDeckFile, type FileCard } from './catalogFixtures';

// The owner's publishing CLI against the test database (BUILD_BRIEF_M6_M8 §7.4, §7.8):
// `pnpm deck validate | publish [--unlisted] [--yes] | list | unlist`.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

const prisma = testPrisma();

interface Run {
  code: number;
  out: string;
  err: string;
  asked: string[];
}

/** Runs the CLI with files from `files`, answering every confirmation with `answer`. */
async function run(
  args: string[],
  files: Record<string, unknown> = {},
  answer = true,
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: CliIO = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    confirm: (question) => {
      asked.push(question);
      return Promise.resolve(answer);
    },
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      const content = files[path];
      return typeof content === 'string' ? content : JSON.stringify(content);
    },
    prisma: () => prisma,
    target: 'test database (localhost)',
  };
  const code = await runDeckCli(args, io);
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

const v1 = rawDeckFile();
const v2Cards: FileCard[] = [
  ['u1-001', 1, basic('What is a DBMS?')],
  ['u1-002', 1, basic('What is a candidate key?')], // changed
  // u2-001 removed
  ['u2-002', 2, basic('What is a join?')], // added
];
const v2 = rawDeckFile({ version: 2 }, v2Cards);

describe('pnpm deck validate', () => {
  it('prints a summary: cards per unit and per type, and the warnings', async () => {
    const r = await run(['validate', 'dbms.json'], { 'dbms.json': v1 });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/sppu-te-cse-dbms v1/);
    expect(r.out).toMatch(/Unit 1 \(Introduction\): 2 cards/);
    expect(r.out).toMatch(/Unit 2 \(Relational model\): 1 card\b/);
    expect(r.out).toMatch(/basic: 3/);
    expect(r.out).toMatch(/Warnings \(2\)/); // both units lack long answers
    expect(r.out).toMatch(/Unit 1 \(Introduction\) has no long-answer cards/);
  });

  it('an invalid file: every error, exit code 1, nothing written', async () => {
    const bad = rawDeckFile({ titel: 'typo', catalog: { pattern: '2024 Pattern' } });
    const r = await run(['validate', 'bad.json'], { 'bad.json': bad });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/titel/);
    expect(r.err).toMatch(/catalog\.pattern: must be the syllabus year only/);
  });

  it('a file that isn’t JSON, or doesn’t exist', async () => {
    expect((await run(['validate', 'x.json'], { 'x.json': '{ nope' })).err).toMatch(
      /not valid JSON/,
    );
    expect((await run(['validate', 'missing.json'])).err).toMatch(/Can’t read missing\.json/);
  });
});

describe('pnpm deck publish', () => {
  it('publishes v1, then v2 with the correct diff (added / changed / removed, one-line previews)', async () => {
    const first = await run(['publish', 'v1.json'], { 'v1.json': v1 });
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/New deck sppu-te-cse-dbms: 3 cards/);
    expect(first.asked[0]).toMatch(/Publish sppu-te-cse-dbms v1 to test database \(localhost\)\?/);

    const second = await run(['publish', 'v2.json'], { 'v2.json': v2 });
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/v1 → v2/);
    expect(second.out).toMatch(/Added \(1\):\n {2}\+ u2-002 {2}What is a join\?/);
    expect(second.out).toMatch(/Changed \(1\):\n {2}~ u1-002 {2}What is a candidate key\?/);
    expect(second.out).toMatch(/Removed \(1\):\n {2}- u2-001 {2}What is a view\?/);
    expect(second.out).toMatch(/Published sppu-te-cse-dbms v2/);

    const rows = await prisma.catalogDeckVersion.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.cardCount])).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(
      (await prisma.catalogDeck.findUnique({ where: { slug: 'sppu-te-cse-dbms' } }))?.latestVersion,
    ).toBe(2);
  });

  it('a long preview is cut to one line', async () => {
    await run(['publish', 'v1.json'], { 'v1.json': v1 });
    const long = 'Explain, in detail and with an example, why '.repeat(5);
    const r = await run(['publish', 'v2.json'], {
      'v2.json': rawDeckFile({ version: 2 }, [
        ...v2Cards,
        ['u2-003', 2, basic(`${long}\nsecond line`)],
      ]),
    });
    const line = r.out.split('\n').find((l) => l.includes('u2-003')) ?? '';
    expect(line.length).toBeLessThanOrEqual(90);
    expect(line).toMatch(/…$/);
    expect(line).not.toMatch(/second line/);
  });

  it('refuses a version that skips (v3 after v1) or repeats (v1 again), writing nothing', async () => {
    await run(['publish', 'v1.json'], { 'v1.json': v1 });
    const skip = await run(['publish', 'v3.json'], { 'v3.json': rawDeckFile({ version: 3 }) });
    expect(skip.code).toBe(1);
    expect(skip.err).toMatch(/version must be 2 \(the latest is 1\), got 3/);
    const again = await run(['publish', 'v1.json'], { 'v1.json': v1 });
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/version must be 2 \(the latest is 1\), got 1/);
    const first = await run(['publish', 'new.json'], {
      'new.json': rawDeckFile({ slug: 'brand-new', version: 2 }),
    });
    expect(first.err).toMatch(/version must be 1 \(a new deck\), got 2/);
    expect(await prisma.catalogDeckVersion.count()).toBe(1);
  });

  it('answering no publishes nothing; --yes skips the question', async () => {
    const no = await run(['publish', 'v1.json'], { 'v1.json': v1 }, false);
    expect(no.code).toBe(1);
    expect(no.out).toMatch(/Not published/);
    expect(await prisma.catalogDeckVersion.count()).toBe(0);
    const yes = await run(['publish', 'v1.json', '--yes'], { 'v1.json': v1 }, false);
    expect(yes.code).toBe(0);
    expect(yes.asked).toEqual([]);
    expect(await prisma.catalogDeckVersion.count()).toBe(1);
  });

  it('an invalid file is never published', async () => {
    const r = await run(['publish', 'bad.json', '--yes'], {
      'bad.json': rawDeckFile({ version: 0 }),
    });
    expect(r.code).toBe(1);
    expect(await prisma.catalogDeckVersion.count()).toBe(0);
  });

  it('--unlisted publishes without listing it in the store', async () => {
    await run(['publish', 'v1.json', '--unlisted', '--yes'], { 'v1.json': v1 });
    const t = makeTestApp();
    expect((await request(t.app).get('/catalog').expect(200)).body).toEqual({ decks: [] });
    await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/1').expect(200);
  });
});

describe('published versions are immutable', () => {
  it('the database refuses UPDATE and DELETE of a published version', async () => {
    await run(['publish', 'v1.json', '--yes'], { 'v1.json': v1 });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE catalog_deck_version SET card_count = 99`),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM catalog_deck_version`)).rejects.toThrow(
      /immutable/,
    );
    expect((await prisma.catalogDeckVersion.findFirst())?.cardCount).toBe(3);
  });
});

describe('pnpm deck list / unlist', () => {
  it('list shows slug, version, status, price and card count', async () => {
    await run(['publish', 'v1.json', '--yes'], { 'v1.json': v1 });
    await run(['publish', 'paid.json', '--yes'], {
      'paid.json': rawDeckFile({ slug: 'sppu-te-aids-ml', price: 4900 }),
    });
    const r = await run(['list']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/sppu-te-aids-ml\s+v1\s+published\s+₹49\s+3 cards/);
    expect(r.out).toMatch(/sppu-te-cse-dbms\s+v1\s+published\s+Free\s+3 cards/);
  });

  it('unlist hides the deck from /catalog; its versions stay fetchable for students who have it', async () => {
    await run(['publish', 'v1.json', '--yes'], { 'v1.json': v1 });
    const r = await run(['unlist', 'sppu-te-cse-dbms']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/sppu-te-cse-dbms is now unlisted/);
    const t = makeTestApp();
    expect((await request(t.app).get('/catalog').expect(200)).body).toEqual({ decks: [] });
    await request(t.app).get('/catalog/sppu-te-cse-dbms/versions/1').expect(200);
    expect((await run(['list'])).out).toMatch(/sppu-te-cse-dbms\s+v1\s+unlisted/);
    // Publishing a new version lists it again only if asked to stay listed (default).
    expect((await run(['unlist', 'nope'])).err).toMatch(/No deck nope/);
  });

  it('unknown command: usage and exit code 2', async () => {
    const r = await run(['frobnicate']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage: pnpm deck/);
  });
});

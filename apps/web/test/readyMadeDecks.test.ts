import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DECKS_DIR,
  DeckValidationError,
  loadReadyMadeDecks,
} from '../build/readyMadeDecks';

const dirs: string[] = [];
function deckDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'decks-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const deck = (id: string, extra: object = {}) => ({
  prebuiltId: id,
  name: 'Deck',
  description: 'About it.',
  version: 1,
  cards: [{ front: 'Q', back: 'A' }],
  ...extra,
});

describe('loadReadyMadeDecks (build-time validation)', () => {
  it('loads valid decks, sorted by name', () => {
    const dir = deckDir({
      'b-v1.json': deck('b-v1', { name: 'Beta' }),
      'a-v1.json': deck('a-v1', { name: 'Alpha' }),
      'notes.txt': 'ignored',
    });
    expect(loadReadyMadeDecks(dir).map((d) => d.name)).toEqual(['Alpha', 'Beta']);
  });

  it('fails with a clear message naming the file and the field', () => {
    const dir = deckDir({ 'bad-v1.json': deck('bad-v1', { cards: [{ front: 'Q', back: '' }] }) });
    expect(() => loadReadyMadeDecks(dir)).toThrow(DeckValidationError);
    expect(() => loadReadyMadeDecks(dir)).toThrow(/bad-v1\.json[\s\S]*cards\.0\.back/);
  });

  it('fails on JSON syntax errors', () => {
    const dir = deckDir({ 'broken-v1.json': '{ "prebuiltId": ' });
    expect(() => loadReadyMadeDecks(dir)).toThrow(/broken-v1\.json[\s\S]*not valid JSON/);
  });

  it('requires the file name to match prebuiltId, and ids to be unique', () => {
    expect(() => loadReadyMadeDecks(deckDir({ 'x-v1.json': deck('y-v1') }))).toThrow(
      /x-v1\.json[\s\S]*file name must be "y-v1\.json"/,
    );
  });

  it('the bundled content is valid and has the placeholder DBMS deck (~20 cards)', () => {
    const decks = loadReadyMadeDecks(DEFAULT_DECKS_DIR);
    const dbms = decks.find((d) => d.prebuiltId === 'dbms-basics-v1');
    expect(dbms?.name).toBe('DBMS Basics');
    expect(dbms?.cards.length).toBeGreaterThanOrEqual(18);
    expect(dbms?.cards.length).toBeLessThanOrEqual(22);
  });
});

describe('the production build', () => {
  it('fails with a clear message when a deck file is invalid', () => {
    const dir = deckDir({ 'oops-v1.json': deck('oops-v1', { version: 0 }) });
    const outDir = mkdtempSync(join(tmpdir(), 'build-'));
    dirs.push(outDir);
    mkdirSync(outDir, { recursive: true });
    const result = spawnSync(
      'pnpm',
      ['exec', 'vite', 'build', '--configLoader', 'runner', '--outDir', outDir, '--emptyOutDir'],
      {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, READY_MADE_DECKS_DIR: dir },
        encoding: 'utf8',
        shell: true,
      },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /Invalid ready-made deck[\s\S]*oops-v1\.json[\s\S]*version/,
    );
  }, 120_000);
});

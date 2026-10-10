// Build-time pipeline for ready-made decks (brief §11, M3): read content/decks/*.json,
// validate each file with the core schema, and expose them to the app as the virtual
// module `virtual:ready-made-decks`. Any invalid file fails the build with a message
// that names the file and the field.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrebuiltDeckSchema, type PrebuiltDeck } from '@recall/core';
import type { Plugin } from 'vite';

export const DEFAULT_DECKS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'content',
  'decks',
);

export class DeckValidationError extends Error {
  constructor(problems: string[]) {
    super(`Invalid ready-made deck content:\n${problems.map((p) => `  • ${p}`).join('\n')}`);
    this.name = 'DeckValidationError';
  }
}

/** Every *.json deck in `dir`, validated; throws DeckValidationError listing every problem. */
export function loadReadyMadeDecks(dir: string): PrebuiltDeck[] {
  const problems: string[] = [];
  const decks: PrebuiltDeck[] = [];
  const shown = (file: string) => relative(process.cwd(), join(dir, file)) || file;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      problems.push(
        `${shown(file)}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    const parsed = PrebuiltDeckSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${shown(file)}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
      continue;
    }
    const expected = `${parsed.data.prebuiltId}.json`;
    if (basename(file) !== expected) {
      problems.push(`${shown(file)}: file name must be "${expected}" (it must match prebuiltId)`);
      continue;
    }
    decks.push(parsed.data);
  }

  const ids = decks.map((d) => d.prebuiltId);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) problems.push(`duplicate prebuiltId "${id}"`);
  }
  if (problems.length > 0) throw new DeckValidationError(problems);
  return decks.sort((a, b) => a.name.localeCompare(b.name));
}

const VIRTUAL_ID = 'virtual:ready-made-decks';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * Vite plugin. The decks are compiled into the JS bundle, so the service worker
 * precaches them with the app shell and they work offline.
 * `READY_MADE_DECKS_DIR` overrides the folder (used by the build-failure test).
 */
export function readyMadeDecksPlugin(
  dir = process.env.READY_MADE_DECKS_DIR ?? DEFAULT_DECKS_DIR,
): Plugin {
  return {
    name: 'recall:ready-made-decks',
    // Validate up front, so a bad file fails the build even if nothing imported it yet.
    buildStart() {
      loadReadyMadeDecks(dir);
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      for (const file of readdirSync(dir)) this.addWatchFile(join(dir, file));
      // Throwing here fails `vite build` (and shows the error overlay in dev).
      return `export default ${JSON.stringify(loadReadyMadeDecks(dir))};`;
    },
  };
}

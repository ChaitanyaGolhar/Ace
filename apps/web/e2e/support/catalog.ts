import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_DIR, e2eDatabaseUrl, TMP } from './apiServer';

// Publishing store decks in E2E through the owner's real CLI (BUILD_BRIEF_M6_M8 §7.4),
// against the E2E database the API serves.

export type CardJson = Record<string, unknown> & { key: string; unit: number; type: string };

export interface DeckFileOptions {
  slug: string;
  version?: number;
  subject: string;
  title?: string;
  year?: string;
  semester?: number;
  branches?: string[];
  subjectCodes?: Record<string, string | null>;
  units?: { number: number; title: string }[];
  price?: number;
  cards: CardJson[];
}

/** A valid ace-deck@2 file. */
export function deckFile(o: DeckFileOptions): Record<string, unknown> {
  const branches = o.branches ?? ['CSE'];
  return {
    format: 'ace-deck@2',
    slug: o.slug,
    version: o.version ?? 1,
    title: o.title ?? o.subject,
    description: `Unit-wise revision for ${o.subject}.`,
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: o.year ?? 'TE',
      semester: o.semester ?? 5,
      branches,
      subject: o.subject,
      subjectCodes: o.subjectCodes ?? Object.fromEntries(branches.map((b) => [b, null])),
      units: o.units ?? [
        { number: 1, title: 'Introduction' },
        { number: 2, title: 'Relational model' },
      ],
    },
    price: o.price ?? 0,
    author: 'E2E',
    reviewedBy: null,
    lastVerifiedAt: '2026-10-11',
    cards: o.cards,
  };
}

/** A slug no other test in this run uses. */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** `pnpm deck publish <file> --yes` against the E2E database. Returns the CLI output. */
export function publish(file: Record<string, unknown>): string {
  const dir = join(TMP, 'decks');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${String(file.slug)}-v${String(file.version)}.json`);
  writeFileSync(path, JSON.stringify(file, null, 2));
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/deck.ts', 'publish', path, '--yes'],
    {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
      encoding: 'utf8',
    },
  );
}

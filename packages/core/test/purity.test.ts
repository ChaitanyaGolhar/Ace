import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findImports, findPurityViolations } from './helpers/purity';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('purity scanner', () => {
  it('flags clock reads and randomness', () => {
    expect(findPurityViolations('const t = Date.now();')).toEqual(['Date.now']);
    expect(findPurityViolations('const r = Math.random();')).toEqual(['Math.random']);
    expect(findPurityViolations('const d = new Date();')).toEqual(['new Date()']);
    expect(findPurityViolations('const p = performance.now();')).toEqual(['performance.now']);
    expect(findPurityViolations('crypto.randomUUID()')).toEqual(['crypto']);
  });

  it('allows constructing a Date from a given timestamp', () => {
    expect(findPurityViolations('const d = new Date(now);')).toEqual([]);
  });

  it('ignores mentions inside comments', () => {
    expect(findPurityViolations('// never call Date.now() here\n/* Math.random */')).toEqual([]);
  });

  it('lists module specifiers of imports and re-exports', () => {
    const src = [
      "import { z } from 'zod';",
      "import type { Card } from './types';",
      "export * from './queue';",
      "import 'side-effect';",
    ].join('\n');
    expect(findImports(src)).toEqual(['zod', './types', './queue', 'side-effect']);
  });

  it('does not mistake string literals in exports for imports', () => {
    const src = ["export type S = 'new' | 'review';", "export const E = z.enum(['user']);"];
    expect(findImports(src.join('\n'))).toEqual([]);
  });

  it('handles multi-line import lists', () => {
    const src = ['import {', '  a,', '  b,', "} from 'ts-fsrs';"];
    expect(findImports(src.join('\n'))).toEqual(['ts-fsrs']);
  });
});

describe('packages/core source', () => {
  const files = sourceFiles(SRC_DIR);

  it('exists', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s never reads the clock or uses randomness', (file) => {
    expect(findPurityViolations(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it.each(files)('%s only imports ts-fsrs, zod or local modules', (file) => {
    const external = findImports(readFileSync(file, 'utf8')).filter((s) => !s.startsWith('.'));
    for (const specifier of external) {
      expect(['ts-fsrs', 'zod']).toContain(specifier);
    }
  });

  it('has no runtime dependencies besides ts-fsrs and zod', () => {
    const pkg = JSON.parse(readFileSync(join(SRC_DIR, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['ts-fsrs', 'zod']);
  });
});

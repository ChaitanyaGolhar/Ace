// A deliberately simple text scanner. It backs up the ESLint rule for packages/core
// so that `pnpm test` alone catches impure code. It is not a JS parser: it strips
// comments first so that prose like "never call Date.now()" isn't flagged.

const FORBIDDEN: readonly { label: string; pattern: RegExp }[] = [
  { label: 'Date.now', pattern: /\bDate\.now\b/ },
  { label: 'Math.random', pattern: /\bMath\.random\b/ },
  { label: 'new Date()', pattern: /\bnew\s+Date\s*\(\s*\)/ },
  { label: 'performance.now', pattern: /\bperformance\.now\b/ },
  { label: 'crypto', pattern: /\bcrypto\b/ },
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function findPurityViolations(source: string): string[] {
  const code = stripComments(source);
  return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(({ label }) => label);
}

export function findImports(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  // Either a bare `import 'x'`, or an import/export statement that reaches `from 'x'`
  // without crossing a `;` (so string literals in later statements aren't matched).
  const re =
    /^\s*(?:import\s*['"]([^'"]+)['"]|(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"])/gm;
  for (const match of code.matchAll(re)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) specifiers.push(specifier);
  }
  return specifiers;
}

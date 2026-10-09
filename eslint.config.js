// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Plain JS config files are not part of any tsconfig project.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // packages/core must stay deterministic: time is passed in, never read.
    // A test (test/purity.test.ts) enforces the same rule so `pnpm test` catches it too.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'core is pure: pass `now` in.' },
        { object: 'Math', property: 'random', message: 'core is deterministic: no randomness.' },
        { object: 'performance', property: 'now', message: 'core is pure: pass `now` in.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'core is pure: `new Date()` reads the clock. Pass `now` in.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'crypto', message: 'core is deterministic: no randomness.' },
        { name: 'fetch', message: 'core is pure: no I/O.' },
        { name: 'localStorage', message: 'core is pure: no I/O.' },
      ],
    },
  },
  prettier,
);

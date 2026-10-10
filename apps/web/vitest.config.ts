import { defineConfig } from 'vitest/config';

// Dexie runs against an in-memory IndexedDB implementation in Node.
const setupFiles = ['fake-indexeddb/auto'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/integration/**'],
          setupFiles,
        },
      },
      {
        // Against the real API and Postgres. Runs after the unit tests (groupOrder), so
        // the CPU-heavy big-deck tests can't slow its network round-trips into timeouts.
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          setupFiles,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});

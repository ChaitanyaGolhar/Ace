import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Dexie runs against an in-memory IndexedDB implementation in Node.
    setupFiles: ['fake-indexeddb/auto'],
  },
});

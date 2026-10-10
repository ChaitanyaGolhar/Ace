import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build (`vite preview`), because the offline tests
 * need the real service worker. Tests run one at a time: some of them stop and
 * restart shared servers.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // The real API (port 3100, its own E2E database) runs for the whole suite.
  globalSetup: './e2e/support/globalSetup.ts',
  globalTeardown: './e2e/support/globalTeardown.ts',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
    // The build talks to the E2E API.
    env: { VITE_API_URL: 'http://localhost:3100' },
  },
});

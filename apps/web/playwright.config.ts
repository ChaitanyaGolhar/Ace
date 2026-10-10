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
  },
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildSeedBackup } from './fixtures/seedBackup';

// Automated accessibility checks (WCAG 2.1 A/AA, incl. 4.5:1 text contrast) on Home,
// Review and Settings, in both themes.

const NOW = Date.parse('2026-10-10T03:30:00Z');

async function seed(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Backup file to import').setInputFiles({
    name: 'seed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildSeedBackup(NOW))),
  });
  await expect(page.getByTestId('toast')).toContainText('Backup imported');
}

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`axe · ${theme}`, () => {
    test.use({ colorScheme: theme, timezoneId: 'Asia/Kolkata' });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await seed(page);
    });

    test('Home', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
      await expectNoViolations(page);
    });

    test('Review (question and revealed answer)', async ({ page }) => {
      await page.goto('/study');
      await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Show answer' }).click();
      await expect(page.getByTestId('card-back')).toBeVisible();
      await expectNoViolations(page);
    });

    test('Settings', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expectNoViolations(page);
    });
  });
}

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

    test('Review: every question type (M6), before and after answering', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('list', { name: 'Decks' })
        .getByRole('link', { name: /Question types/ })
        .click();
      await page.getByRole('link', { name: 'Study deck' }).click();
      const type = page.getByTestId('card-type');
      const rate = (label: string) =>
        page
          .getByRole('group', { name: 'Rate your recall' })
          .getByRole('button', { name: new RegExp(`^${label}`) })
          .click();

      await expect(type).toHaveText('Multiple choice');
      await expectNoViolations(page);
      await page.getByRole('radio', { name: /^B\./ }).click();
      await expectNoViolations(page); // an option chosen
      await page.getByRole('button', { name: 'Check' }).click();
      await expectNoViolations(page); // ✓ / ✗ shown
      await rate('Good');

      await expect(type).toHaveText('Fill in the blank');
      await page.getByRole('button', { name: 'Show hint' }).click();
      await expectNoViolations(page);
      await page.getByLabel('Your answer').fill('group by');
      await page.getByRole('button', { name: 'Check' }).click();
      await expect(page.getByTestId('cloze-result')).toContainText('Correct');
      await expectNoViolations(page);
      await rate('Good');

      await expect(type).toHaveText('Short answer');
      await page.getByRole('button', { name: 'Type your answer (optional)' }).click();
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Show answer' }).click();
      await expectNoViolations(page);
      await rate('Good');

      await expect(type).toHaveText('Long answer');
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Show key points' }).click();
      await page.getByTestId('key-points').getByRole('checkbox').first().check();
      await page.getByText('Model answer').click();
      await expectNoViolations(page); // checklist, suggestion, model answer open
    });

    test('Card editor: every type (M6)', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('list', { name: 'Decks' })
        .getByRole('link', { name: /Question types/ })
        .click();
      await page.getByRole('link', { name: 'Add card' }).click();
      for (const label of [
        'Basic',
        'Multiple choice',
        'Fill in the blank',
        'Short answer',
        'Long answer',
      ]) {
        await page
          .getByRole('radiogroup', { name: 'Card type' })
          .getByRole('radio', { name: label })
          .click();
        await expect(page.getByRole('radio', { name: label })).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await expectNoViolations(page);
      }
    });

    test('Settings', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expectNoViolations(page);
    });
  });
}

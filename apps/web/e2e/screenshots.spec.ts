import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { buildSeedBackup } from './fixtures/seedBackup';
import { uniqueEmail } from './helpers';
import { magicLinkFor } from './support/apiServer';

// Screenshots of every screen at 390×844 and 1280×800, dark and light, into
// docs/ui-design/_actual/ for comparison with the approved mocks. Opt-in:
//   SCREENSHOTS=1 pnpm --filter @recall/web exec playwright test e2e/screenshots.spec.ts
test.skip(process.env.SCREENSHOTS !== '1', 'set SCREENSHOTS=1 to capture screenshots');

const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'ui-design', '_actual');
/** 2026-10-10 09:00 in Asia/Kolkata. */
const NOW = Date.parse('2026-10-10T03:30:00Z');

test.use({ timezoneId: 'Asia/Kolkata' });

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const THEMES = ['dark', 'light'] as const;
const ROBBINS = 'Robbins Ch. 3 — Inflammation and Repair';

async function seed(page: Page) {
  await page.goto('/settings');
  const backup = buildSeedBackup(NOW);
  await page.getByLabel('Backup file to import').setInputFiles({
    name: 'seed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByTestId('toast')).toContainText('Backup imported');
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`screens · ${viewport.name} · ${theme}`, async ({ page }) => {
      test.setTimeout(180_000);
      mkdirSync(OUT, { recursive: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.clock.setFixedTime(NOW);
      const shot = async (name: string, options: { viewportOnly?: boolean } = {}) => {
        // Every page load starts a sync; capture the settled status, not "Syncing…".
        await expect(page.getByText('Syncing…')).toHaveCount(0);
        await expect(page.getByRole('link', { name: /^Sync status: Syncing/ })).toHaveCount(0);
        await page.waitForTimeout(150);
        // Mobile mocks are one screen tall (fixed tab bar); desktop mocks show the whole page.
        await page.screenshot({
          path: join(OUT, `${name}-${viewport.name}-${theme}.png`),
          fullPage: viewport.name === 'desktop' && !options.viewportOnly,
        });
      };

      // First visit (no decks).
      await page.goto('/');
      await expect(page.getByTestId('welcome')).toBeVisible();
      await shot('welcome');

      await seed(page);

      // Sign in (the real API), so every later screen shows the real "Synced" status.
      await page.goto('/signin');
      await expect(page.getByLabel('Email')).toBeVisible();
      await shot('signin');
      const email = uniqueEmail();
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Email me a link' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      await shot('signin-check-email');
      await page.goto(await magicLinkFor(email));
      await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
      await shot('home');

      await page.goto('/decks');
      await expect(page.getByRole('heading', { name: 'Decks', level: 1 })).toBeVisible();
      await shot('decks');

      await page.getByRole('link', { name: /Operating Systems/ }).click();
      await expect(
        page.getByRole('heading', { name: 'Operating Systems', level: 1 }),
      ).toBeVisible();
      await shot('deck-detail');

      await page.getByRole('button', { name: 'Card options: What is a process?' }).click();
      await page.getByRole('menuitem', { name: 'Delete card' }).click();
      await expect(page.getByTestId('toast')).toBeVisible();
      await shot('deck-detail-toast');
      await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();

      await page.getByRole('link', { name: 'Add card' }).click();
      await page.getByLabel('Question').fill('What does a foreign key constraint guarantee?');
      await shot('card-editor');
      await page.getByLabel('Answer').fill('Every value matches a key in the referenced table.');
      await page.getByRole('button', { name: 'Save & add another' }).click();
      await expect(page.getByTestId('added-status')).toContainText('1 card added');
      await shot('card-editor-added');
      await page.getByRole('button', { name: 'Save and close' }).click();

      await page.getByRole('link', { name: 'Study deck' }).click();
      await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
      await shot('review-front');
      await page.keyboard.press('Space');
      await expect(page.getByTestId('card-back')).toBeVisible();
      await shot('review-revealed');
      await page.keyboard.press('3');
      await expect(page.getByTestId('undo-pill')).toBeVisible();
      await shot('review-undo-pill');
      // Finish the session for the completion screen.
      for (let i = 0; i < 40; i++) {
        if (await page.getByRole('heading', { name: 'Review complete' }).isVisible()) break;
        const show = page.getByRole('button', { name: 'Show answer' });
        await expect(show.or(page.getByRole('heading', { name: 'Review complete' }))).toBeVisible();
        if (!(await show.isVisible())) break;
        await show.click();
        await page.getByRole('button', { name: /^Easy · / }).click();
        await page.waitForTimeout(100);
      }
      await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
      await shot('review-complete');

      await page.goto('/browse');
      await shot('browse');
      await page.getByRole('button', { name: 'Add DBMS Basics' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'DBMS Basics' })).toBeVisible();
      await page.goto('/browse');
      await page.getByRole('button', { name: 'Add DBMS Basics' }).click();
      await expect(page.getByRole('dialog', { name: 'Add DBMS Basics again?' })).toBeVisible();
      await shot('browse-duplicate');
      await page.getByRole('button', { name: 'Keep one copy' }).click();

      // A card from the bundled Robbins deck: multi-line question, long answer.
      // (The frozen clock moves on 5 minutes: a new session must start after the
      // earlier session's reviews, as it always does with a running clock.)
      await page.clock.setFixedTime(NOW + 5 * 60_000);
      await page.goto('/browse');
      await page.getByRole('button', { name: `Add ${ROBBINS}` }).click();
      await expect(page.getByRole('heading', { level: 1, name: ROBBINS })).toBeVisible();
      await page.getByRole('link', { name: 'Study deck' }).click();
      await expect(page.getByTestId('card-front')).toContainText('Inflammation is best defined');
      // What the window shows: a full-page capture would draw the sticky rating bar
      // mid-page, over the answer.
      await shot('robbins-review-front', { viewportOnly: true });
      await page.keyboard.press('Space');
      await expect(page.getByTestId('card-back')).toBeVisible();
      await shot('robbins-review-revealed', { viewportOnly: true });
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      await shot('robbins-review-revealed-end', { viewportOnly: true });
      await page.getByRole('button', { name: 'End session' }).click();
      await page.clock.setFixedTime(NOW);
      await page.goto('/stats');
      await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
      await shot('stats');
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      await expect(page.getByRole('main').getByTestId('sync-status')).toContainText('Synced');
      await shot('settings');
      await page.goto('/search');
      await page.getByLabel('Search decks and cards').fill('process');
      await shot('search');
    });
  }
}

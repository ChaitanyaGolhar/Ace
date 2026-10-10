import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readStore, type StoredState } from './helpers';

test('first visit: the first card is shown within 3 taps, with no forms', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  let taps = 0;

  // Both bundled decks are offered right on the welcome screen, Robbins first.
  const offered = page.getByRole('list', { name: 'Start with a ready-made deck' });
  await expect(offered.getByRole('heading', { level: 3 })).toHaveText([
    'Robbins Ch. 3 — Inflammation and Repair',
    'DBMS Basics',
  ]);
  await expect(offered.getByRole('listitem').first()).toContainText('1,014 cards');
  await expect(offered.getByRole('listitem').last()).toContainText('20 cards');
  await page
    .getByRole('button', { name: 'Add & start with Robbins Ch. 3 — Inflammation and Repair' })
    .click();
  taps += 1;

  await expect(page.getByTestId('card-front')).toContainText('Inflammation is best defined');
  await expect(page.getByTestId('card-kind')).toHaveText('New');
  await expect(page.getByTestId('first-card-hint')).toHaveText(
    'Try to recall the answer, then tap Show answer.',
  );
  expect(taps).toBeLessThanOrEqual(3);
  // No form was involved: nothing on the way asked for text.
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('ready-made decks: adding a deck you already have warns first', async ({ page }) => {
  await page.goto('/browse');
  const rows = page.getByRole('list', { name: 'Ready-made decks' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('DBMS Basics');
  await expect(rows.nth(0)).toContainText('20 cards');
  await expect(rows.nth(1)).toContainText('Robbins Ch. 3 — Inflammation and Repair');
  await expect(rows.nth(1)).toContainText('1,014 cards');
  const row = rows.filter({ hasText: 'DBMS Basics' });

  await page.getByRole('button', { name: 'Add DBMS Basics' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'DBMS Basics' })).toBeVisible();
  await expect(
    page.getByText('Ready-made deck. These are your copies — edit any card freely.'),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('listitem')).toHaveCount(20);

  await page.goto('/browse');
  await expect(row).toContainText('In your decks');
  await page.getByRole('button', { name: 'Add DBMS Basics' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add DBMS Basics again?' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Keep one copy' })).toBeFocused();
  await sheet.getByRole('button', { name: 'Keep one copy' }).click();
  await expect(sheet).toBeHidden();
  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' }).getByRole('listitem')).toHaveCount(1);

  await page.goto('/browse');
  await page.getByRole('button', { name: 'Add DBMS Basics' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add a second copy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'DBMS Basics' })).toBeVisible();
  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' }).getByRole('listitem')).toHaveCount(2);
});

test('backup: export, import into a fresh browser (identical states), import again (no change)', async ({
  browser,
}) => {
  const source = await browser.newContext();
  const page = await source.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Add & start with DBMS Basics' }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: /^Good · / }).click();
  }
  await page.getByRole('button', { name: 'End session' }).click();
  const statesBefore = await readStore<StoredState>(page, 'cardStates');

  await page.goto('/settings');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloading;
  const file = await download.path();
  const backup = readFileSync(file, 'utf8');
  // M6 (D-323): exports are backup version 2 (typed cards, outcomes); version 1 still imports.
  expect(JSON.parse(backup)).toMatchObject({ format: 'recall-backup', version: 2 });

  const fresh = await browser.newContext();
  const page2 = await fresh.newPage();
  await page2.goto('/settings');
  const importFile = {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  };
  await page2.getByLabel('Backup file to import').setInputFiles(importFile);
  await expect(page2.getByTestId('toast')).toContainText('Backup imported and merged.');
  const byId = (s: StoredState[]) => [...s].sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
  expect(byId(await readStore<StoredState>(page2, 'cardStates'))).toEqual(byId(statesBefore));

  await page2.getByLabel('Backup file to import').setInputFiles(importFile);
  await expect(page2.getByTestId('toast').last()).toContainText('Everything was already here.');

  await source.close();
  await fresh.close();
});

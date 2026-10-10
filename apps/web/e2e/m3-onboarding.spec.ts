import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readStore, type StoredState } from './helpers';

test('first visit: the first card is shown within 3 taps, with no forms', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  let taps = 0;

  // The ready-made deck is offered right on the welcome screen.
  await expect(page.getByRole('heading', { name: 'DBMS Basics' })).toBeVisible();
  await page.getByRole('button', { name: 'Add & start' }).click();
  taps += 1;

  await expect(page.getByTestId('card-front')).toBeVisible();
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
  const row = page.getByRole('list', { name: 'Ready-made decks' }).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('DBMS Basics');
  await expect(row).toContainText('20 cards');

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
  await page.getByRole('button', { name: 'Add & start' }).click();
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
  expect(JSON.parse(backup)).toMatchObject({ format: 'recall-backup', version: 1 });

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

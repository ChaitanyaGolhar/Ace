import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readStore, type StoredState } from './helpers';
import { deckFile, publish, uniqueSlug, type CardJson } from './support/catalog';

const cards = (n: number): CardJson[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `u1-${String(i + 1).padStart(3, '0')}`,
    unit: 1,
    type: 'basic',
    front: `Question ${String(i + 1)}`,
    back: `Answer ${String(i + 1)}`,
  }));

// M7 (BUILD_BRIEF_M6_M8 §7.7): no decks are bundled any more; the welcome screen leads to
// the Store. The first card is now 4 taps away (was 3 with a bundled deck): Find your
// subject → the subject → Add to my decks → Study deck.
test('first visit: Find your subject → a store deck → its first card in 4 taps, with no forms', async ({
  page,
}) => {
  const subject = `First visit ${uniqueSlug('s')}`;
  publish(deckFile({ slug: uniqueSlug('first'), subject, cards: cards(20) }));
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  let taps = 0;

  await page.getByRole('link', { name: 'Find your subject' }).click();
  taps += 1;
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  taps += 1;
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  taps += 1;
  await page.getByRole('link', { name: 'Study deck' }).click();
  taps += 1;

  await expect(page.getByTestId('card-front')).toHaveText('Question 1');
  await expect(page.getByTestId('card-kind')).toHaveText('New');
  await expect(page.getByTestId('first-card-hint')).toHaveText(
    'Try to recall the answer, then tap Show answer.',
  );
  expect(taps).toBe(4);
  // No form was involved: nothing on the way asked for text.
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('store decks: adding a deck you already have warns first', async ({ page }) => {
  const subject = `Twice ${uniqueSlug('s')}`;
  publish(deckFile({ slug: uniqueSlug('twice'), subject, cards: cards(20) }));
  const open = async () => {
    await page.goto('/store');
    await page.getByPlaceholder('Search subjects').fill(subject);
    await page
      .getByRole('list', { name: 'Store decks' })
      .getByRole('link', { name: new RegExp(subject) })
      .click();
  };

  await open();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(
    page.getByText(/From the store\. These are your copies — edit any card freely\./),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('listitem')).toHaveCount(20);

  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill(subject);
  await expect(page.getByRole('list', { name: 'Store decks' })).toContainText('In your decks');
  await open();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  const sheet = page.getByRole('dialog', { name: `Add ${subject} again?` });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Keep one copy' })).toBeFocused();
  await sheet.getByRole('button', { name: 'Keep one copy' }).click();
  await expect(sheet).toBeHidden();
  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' }).getByRole('listitem')).toHaveCount(1);

  await open();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add a second copy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' }).getByRole('listitem')).toHaveCount(2);
});

test('backup: export, import into a fresh browser (identical states), import again (no change)', async ({
  browser,
}) => {
  const source = await browser.newContext();
  const page = await source.newPage();
  const subject = `Backup ${uniqueSlug('s')}`;
  publish(deckFile({ slug: uniqueSlug('backup'), subject, cards: cards(20) }));
  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill(subject);
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await page.getByRole('link', { name: 'Study deck' }).click();
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

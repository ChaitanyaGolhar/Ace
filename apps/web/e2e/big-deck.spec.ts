import { expect, test } from '@playwright/test';
import { bigQuestion, buildBigDeckBackup } from './fixtures/bigDeckBackup';

// A 1,000-card deck with 5,000 review logs, in a real browser against the production
// build: the deck page and the review queue stay fast, and the deck page shows the
// cards a page at a time (DECISIONS D-317).

test('a 1,000-card deck with 5,000 review logs: deck page and queue stay fast', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const backup = buildBigDeckBackup(Date.now());
  expect(backup.reviewLogs).toHaveLength(5000);
  const deckId = backup.decks[0]?.id ?? '';

  await page.goto('/settings');
  await page.getByLabel('Backup file to import').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByTestId('toast')).toContainText('Backup imported', { timeout: 60_000 });

  const list = page.getByRole('list', { name: 'Cards' });

  // Cold: load the app straight onto the deck page.
  let t = Date.now();
  await page.goto(`/decks/${deckId}`);
  await expect(list.getByRole('listitem').first()).toBeVisible();
  const deckPageColdMs = Date.now() - t;

  // In-app: from the Decks list to the deck page (render only, app already running).
  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' })).toBeVisible();
  t = Date.now();
  await page.getByRole('list', { name: 'Decks' }).getByRole('link').first().click();
  await expect(list.getByRole('listitem').first()).toBeVisible();
  const deckPageInAppMs = Date.now() - t;
  const rows = await list.getByRole('listitem').count();

  // Building the queue: Home → "Start reviewing" → the first card.
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start reviewing' })).toBeVisible();
  t = Date.now();
  await page.getByRole('button', { name: 'Start reviewing' }).click();
  await expect(page.getByTestId('card-front')).toBeVisible();
  const queueMs = Date.now() - t;

  // eslint-disable-next-line no-console -- timings for the report
  console.info(
    `[e2e timings] deck page cold load: ${String(deckPageColdMs)} ms · deck page in-app: ` +
      `${String(deckPageInAppMs)} ms (${String(rows)} rows) · queue → first card: ${String(queueMs)} ms`,
  );
  expect(deckPageColdMs).toBeLessThan(5000);
  expect(deckPageInAppMs).toBeLessThan(2000);
  expect(queueMs).toBeLessThan(2000);

  // Pagination: 100 cards at a time; search covers all 1,000.
  await page.goto(`/decks/${deckId}`);
  await expect(list.getByRole('listitem')).toHaveCount(100);
  await expect(page.getByTestId('cards-shown')).toHaveText('Showing 100 of 1,000 cards');
  await expect(list.getByRole('listitem').first()).toContainText(bigQuestion(0));
  await page.getByRole('button', { name: 'Show 100 more cards' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(200);
  await expect(list.getByRole('listitem').nth(100)).toContainText(bigQuestion(100));
  await expect(page.getByTestId('cards-shown')).toHaveText('Showing 200 of 1,000 cards');

  await page.getByLabel('Search cards').fill(bigQuestion(998));
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Show \d+ more cards$/ })).toHaveCount(0);
  await page.getByLabel('Search cards').fill('');
  await expect(list.getByRole('listitem')).toHaveCount(100);
});

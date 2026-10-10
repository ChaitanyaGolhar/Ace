import { expect, test } from '@playwright/test';
import {
  addCards,
  createDeck,
  finishSession,
  numberedCards,
  readStore,
  waitForServiceWorker,
  type StoredLog,
} from './helpers';

test('offline: load once, go offline, reload, create a card and complete a session', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await waitForServiceWorker(page);
  await expect(page.getByTestId('welcome')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('welcome')).toBeVisible();

  await createDeck(page, 'Offline deck');
  await addCards(page, [{ front: 'Made offline', back: 'Yes' }]);
  await page.getByRole('link', { name: 'Study deck' }).click();
  expect(await finishSession(page, () => 'Again')).toBe(2);
  await expect(page.getByTestId('completion-text')).toContainText('You reviewed 2 cards');

  // Deep links work offline too (the service worker serves the app shell).
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('reload mid-session: no lost or duplicated review, and the session continues', async ({
  page,
}) => {
  await createDeck(page, 'Reload');
  await addCards(page, numberedCards(3, 'R'));
  await page.getByRole('link', { name: 'Study deck' }).click();

  await expect(page.getByTestId('card-front')).toHaveText('R1 front');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect(page.getByTestId('card-front')).toHaveText('R2 front');
  await page.getByRole('button', { name: 'Show answer' }).click();

  await page.reload();

  // The un-rated card comes back with its answer hidden; nothing was recorded for it.
  await expect(page.getByTestId('card-front')).toHaveText('R2 front');
  await expect(page.getByTestId('card-back')).toHaveCount(0);
  await expect(page.getByTestId('position')).toHaveText('2 of 3');
  const logs = await readStore<StoredLog>(page, 'reviewLogs');
  expect(logs).toHaveLength(1);
  // Same session: Undo still reaches the review made before the reload.
  await expect(page.getByTestId('undo-pill')).toBeEnabled();

  await finishSession(page);
  await expect(page.getByTestId('completion-text')).toContainText('You reviewed 3 cards');
  const after = await readStore<StoredLog>(page, 'reviewLogs');
  expect(after).toHaveLength(3);
  expect(new Set(after.map((l) => l.cardId)).size).toBe(3);
});

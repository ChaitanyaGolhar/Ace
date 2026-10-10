import { expect, test, type Page } from '@playwright/test';
import { addCards, createDeck, finishSession, numberedCards, signIn, uniqueEmail } from './helpers';
import { deckFile, publish, uniqueSlug } from './support/catalog';

// Audit after M4: everything UI_REPORT.md listed as hidden or "can't show yet" (it was
// written mid-M2) now works with real data: the real catalog, the real API, real reviews.

test('store links: welcome screen, Home and Decks all lead to the Store', async ({ page }) => {
  const subject = `Links ${uniqueSlug('s')}`;
  publish(
    deckFile({
      slug: uniqueSlug('links'),
      subject,
      cards: [{ key: 'u1-001', unit: 1, type: 'basic', front: 'Q', back: 'A' }],
    }),
  );
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByRole('link', { name: 'Find your subject' }).click();
  await expect(page.getByRole('list', { name: 'Store decks' })).toContainText(subject);

  await createDeck(page, 'Mine');
  await page.goto('/');
  await page.getByRole('link', { name: 'Find decks in the store' }).click();
  await page.getByPlaceholder('Search subjects').fill(subject);
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();

  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('link', { name: 'Find decks in the store' }).click();
  await page.getByPlaceholder('Search subjects').fill(subject);
  await expect(page.getByRole('list', { name: 'Store decks' })).toContainText('In your decks');
});

test('the sign-in screen states the real number of decks that will be merged', async ({ page }) => {
  await createDeck(page, 'One');
  await createDeck(page, 'Two');
  await page.goto('/settings');
  await page
    .getByRole('region', { name: 'Account & sync' })
    .getByRole('link', { name: 'Sign in to sync' })
    .click();
  await expect(page.getByText('The 2 decks on this device stay as they are.')).toBeVisible();
});

const mainStatus = (page: Page) => page.getByRole('main').getByTestId('sync-status');
const sidebarStatus = (page: Page) => page.getByRole('complementary').getByTestId('sync-status');

test('every sync status state, in Settings and the sidebar', async ({ page, context }) => {
  await page.goto('/settings');
  await expect(sidebarStatus(page)).toContainText('On this device only');
  await expect(page.getByRole('region', { name: 'Account & sync' })).toContainText(
    'On this device only',
  );

  await signIn(page, uniqueEmail());
  await expect(mainStatus(page)).toContainText('Synced · just now');

  // Syncing: hold the pull until we've seen the state.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/sync/pull*', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(mainStatus(page)).toContainText('Syncing…');
  await expect(sidebarStatus(page)).toContainText('Syncing…');
  release();
  await expect(mainStatus(page)).toContainText('Synced');
  await page.unroute('**/sync/pull*');

  // Server error: "Couldn't sync · retrying".
  // (Nothing is dirty, so this sync only pulls: fail every sync request.)
  await page.route('**/sync/**', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(mainStatus(page)).toContainText('Couldn’t sync · retrying');
  await expect(sidebarStatus(page)).toContainText('Couldn’t sync · retrying');
  await page.unroute('**/sync/**');

  // Offline.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(mainStatus(page)).toContainText('Offline');
  await expect(sidebarStatus(page)).toContainText('Offline');

  // And back.
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(mainStatus(page)).toContainText('Synced');
});

test('phone width: the top-bar sync button shows the real status', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createDeck(page, 'Phone deck'); // past the welcome screen, which hides the top bar
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sync status: On this device only' })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, uniqueEmail());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: /^Sync status: Synced/ })).toBeVisible();
});

test.describe('stats', () => {
  test.use({ timezoneId: 'UTC' });

  test('Stats show real numbers after studying on two days', async ({ page }) => {
    const day0 = new Date('2026-09-01T12:00:00Z').getTime();
    await page.clock.install({ time: day0 });

    await createDeck(page, 'Stats deck');
    await addCards(page, numberedCards(3, 'S'));
    await page.getByRole('link', { name: 'Study deck' }).click();
    expect(await finishSession(page, () => 'Easy')).toBe(3); // Easy graduates new cards

    // 25 days later every card is due: two remembered (Good), one forgotten (Again).
    await page.clock.setSystemTime(day0 + 25 * 86_400_000);
    await page.goto('/');
    await expect(page.getByTestId('count-reviews')).toHaveText('3');
    await page.getByRole('button', { name: 'Start reviewing' }).click();
    const ratings = ['Good', 'Good', 'Again'] as const;
    expect(await finishSession(page, (i) => ratings[i] ?? 'Good')).toBe(4); // + relearning step

    await page.goto('/stats');
    const tile = (name: string) => page.getByRole('region', { name }).getByTestId('stat-value');
    // 2 of the 3 reviews of learned cards were not Again (the relearning step doesn't count).
    await expect(tile('Remembered on review')).toHaveText('67%');
    await expect(tile('Reviews')).toHaveText('7');
    await expect(tile('Days studied')).toHaveText('2');
    const cards = page.getByRole('region', { name: 'Your cards' });
    await expect(cards.getByTestId('cards-learned')).toHaveText('3');
    await expect(cards.getByTestId('cards-learning')).toHaveText('0');
    await expect(cards.getByTestId('cards-not-seen')).toHaveText('0');
    await expect(page.getByTestId('per-day-readout')).toContainText('4');
  });
});

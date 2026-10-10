import { expect, test, type Page } from '@playwright/test';
import { addCards, createDeck, numberedCards } from './helpers';
import { magicLinkFor, startApi, stopApi } from './support/apiServer';

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `e2e-${String(Date.now())}-${String(counter)}@example.com`;
}

/** Signs in through the UI and the real magic link (read from the API's dev outbox). */
async function signIn(page: Page, email: string) {
  await page.goto('/settings');
  await page
    .getByRole('region', { name: 'Account & sync' })
    .getByRole('link', { name: 'Sign in to sync' })
    .click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await magicLinkFor(email));
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}

async function syncNow(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('main').getByTestId('sync-status')).toContainText('Synced');
}

test('sign in with a magic link; Settings shows the account and "Synced"', async ({ page }) => {
  const email = uniqueEmail();
  await signIn(page, email);
  await expect(page.getByRole('main').getByTestId('sync-status')).toContainText(
    'Synced · just now',
  );
  // The sidebar shows the same status (icon + words).
  await expect(page.getByRole('complementary').getByTestId('sync-status')).toContainText('Synced');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Account & sync' })
      .getByRole('link', { name: 'Sign in to sync' }),
  ).toBeVisible();
  await expect(page.getByRole('complementary').getByTestId('sync-status')).toContainText(
    'On this device only',
  );
});

test('two devices: study offline on A, go online, B shows the updated counts after sync', async ({
  browser,
}) => {
  const email = uniqueEmail();
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();

  await createDeck(pageA, 'Shared deck');
  await addCards(pageA, numberedCards(3, 'S'));
  await signIn(pageA, email); // anonymous data is uploaded on first sign-in
  await syncNow(pageA);

  await signIn(pageB, email);
  await pageB.goto('/');
  await expect(pageB.getByTestId('count-new')).toHaveText('3');

  // A studies all three while offline.
  await a.setOffline(true);
  await pageA.goto('/');
  await pageA.getByRole('button', { name: 'Start reviewing' }).click();
  for (let i = 0; i < 3; i++) {
    await pageA.getByRole('button', { name: 'Show answer' }).click();
    await pageA.getByRole('button', { name: /^Easy · / }).click();
  }
  await expect(pageA.getByRole('heading', { name: 'Review complete' })).toBeVisible();
  await pageA.getByRole('button', { name: 'Back to home' }).click();
  await expect(pageA.getByRole('complementary').getByTestId('sync-status')).toContainText(
    'Offline',
  );

  // Back online: A syncs (the online event), then B syncs.
  await a.setOffline(false);
  await expect(pageA.getByRole('complementary').getByTestId('sync-status')).toContainText(
    'Synced',
    {
      timeout: 20_000,
    },
  );
  await syncNow(pageB);
  await pageB.goto('/');
  await expect(pageB.getByTestId('caught-up')).toBeVisible();

  await a.close();
  await b.close();
});

test('studying is never blocked by sync errors (the API is killed mid-session)', async ({
  page,
}) => {
  const email = uniqueEmail();
  await createDeck(page, 'Resilient');
  await addCards(page, numberedCards(4, 'K'));
  await signIn(page, email);
  await syncNow(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Start reviewing' }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good · / }).click();

  await stopApi();
  try {
    // Keep studying with the API down: every rating still works.
    for (;;) {
      const done = page.getByRole('heading', { name: 'Review complete' });
      const show = page.getByRole('button', { name: 'Show answer' });
      await expect(done.or(show)).toBeVisible();
      if (await done.isVisible()) break;
      await show.click();
      await page.getByRole('button', { name: /^Easy · / }).click();
    }
    await page.getByRole('button', { name: 'Back to home' }).click(); // triggers a sync
    await expect(page.getByRole('complementary').getByTestId('sync-status')).toContainText(
      'Couldn’t sync · retrying',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('caught-up')).toBeVisible();
  } finally {
    await startApi();
  }

  // With the API back, the pending reviews sync.
  await syncNow(page);
});

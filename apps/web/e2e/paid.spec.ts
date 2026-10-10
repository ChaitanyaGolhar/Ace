import { expect, test, type Page } from '@playwright/test';
import { readStore, signIn, uniqueEmail, waitForServiceWorker } from './helpers';
import { magicLinkFor } from './support/apiServer';
import { createCodes, deckFile, publish, uniqueSlug } from './support/catalog';

// M8 paid decks end to end (BUILD_BRIEF_M6_M8 §8.4–8.5): a paid deck in the store, a code
// created with the owner's real CLI, redeemed in the app, the deck added and studied
// offline.

function paidDeck(slug: string, subject: string) {
  return deckFile({
    slug,
    subject,
    year: 'TE',
    semester: 6,
    branches: ['AIDS'],
    price: 4900,
    cards: [
      {
        key: 'u1-001',
        unit: 1,
        type: 'basic',
        front: 'What is supervised learning?',
        back: 'Learning from labelled data.',
      },
      {
        key: 'u1-002',
        unit: 1,
        type: 'basic',
        front: 'What is overfitting?',
        back: 'Fitting noise in the training data.',
      },
    ],
  });
}

async function openDeck(page: Page, subject: string) {
  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill(subject);
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
}

test('sign in → paid deck → redeem a code created by the CLI → deck added → study offline', async ({
  page,
  context,
}) => {
  const slug = uniqueSlug('ml');
  const subject = `Machine Learning ${uniqueSlug('s')}`;
  publish(paidDeck(slug, subject));
  const [code = ''] = createCodes(['--deck', slug, '--count', '1', '--note', 'E2E']);
  expect(code).toMatch(/^ACE-/);

  await page.goto('/');
  await waitForServiceWorker(page);
  await signIn(page, uniqueEmail());
  await openDeck(page, subject);

  // Price, How to buy (server text), Have a code?
  await expect(page.getByRole('list', { name: 'Store decks' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Unlock this deck · ₹49' })).toBeVisible();
  await expect(page.getByTestId('purchase-info')).toContainText(
    'Paid decks are sold by the deck author.',
  );
  await expect(page.getByRole('button', { name: 'Add to my decks' })).toHaveCount(0);

  // A wrong code is explained; the right one (typed loosely) unlocks and adds the deck.
  await page.getByLabel('Unlock code').fill('ACE-0000-0000-00');
  await page.getByRole('button', { name: 'Redeem' }).click();
  await expect(page.getByRole('alert')).toHaveText('This code isn’t valid');
  await page.getByLabel('Unlock code').fill(code.toLowerCase().replace(/-/g, ' '));
  await page.getByRole('button', { name: 'Redeem' }).click();
  await expect(page.getByTestId('toast')).toContainText(`Unlocked — added ${subject}`);
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('listitem')).toHaveCount(2);

  // The store now says "Owned"; events carry slugs and a reason, never the code.
  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill(subject);
  await expect(page.getByRole('list', { name: 'Store decks' })).toContainText('Owned');
  const events = await readStore<{ type: string; props: unknown }>(page, 'events');
  expect(events.filter((e) => e.type === 'code_redeemed').map((e) => e.props)).toEqual([
    { slugs: [slug] },
  ]);
  expect(events.filter((e) => e.type === 'code_redeem_failed').map((e) => e.props)).toEqual([
    { reason: 'invalid' },
  ]);
  expect(events.filter((e) => e.type === 'purchase_info_viewed').map((e) => e.props)).toEqual([
    { slug },
  ]);
  const body = code.slice(4).replace(/-/g, '');
  expect(JSON.stringify(events)).not.toContain(body.slice(0, 4));

  // Once added, a paid deck works offline like any other.
  await context.setOffline(true);
  await page.goto('/decks');
  await page
    .getByRole('list', { name: 'Decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await page.getByRole('link', { name: 'Study deck' }).click();
  await expect(page.getByTestId('card-front')).toHaveText('What is supervised learning?');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good · / }).click();
  await expect(page.getByTestId('card-front')).toHaveText('What is overfitting?');
  await context.setOffline(false);
});

test('signed out: "Sign in to unlock" goes to sign-in and comes back to the deck', async ({
  page,
}) => {
  const slug = uniqueSlug('ml2');
  const subject = `Deep Learning ${uniqueSlug('s')}`;
  publish(paidDeck(slug, subject));
  await openDeck(page, subject);
  await page.getByRole('link', { name: 'Sign in to unlock' }).click();
  const email = uniqueEmail();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await magicLinkFor(email));
  await expect(page).toHaveURL(new RegExp(`/store/${slug}$`));
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(page.getByLabel('Unlock code')).toBeVisible();
});

test('owned on another device: "Owned — Add" (not added automatically)', async ({ browser }) => {
  const slug = uniqueSlug('ml3');
  const subject = `Pattern Recognition ${uniqueSlug('s')}`;
  publish(paidDeck(slug, subject));
  const [code = ''] = createCodes(['--deck', slug, '--count', '1', '--note', 'E2E 2']);
  const email = uniqueEmail();

  const first = await (await browser.newContext()).newPage();
  await signIn(first, email);
  await openDeck(first, subject);
  await first.getByLabel('Unlock code').fill(code);
  await first.getByRole('button', { name: 'Redeem' }).click();
  await expect(first.getByTestId('toast')).toContainText('Unlocked');

  const second = await (await browser.newContext()).newPage();
  await signIn(second, email);
  await second.goto('/decks');
  await expect(second.getByRole('heading', { level: 1, name: 'Decks' })).toBeVisible();
  await expect(second.getByText(subject)).toHaveCount(0);
  await openDeck(second, subject);
  await expect(second.getByText('Owned', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Add to my decks' }).click();
  await expect(second.getByRole('link', { name: 'Study deck' })).toBeVisible();
});

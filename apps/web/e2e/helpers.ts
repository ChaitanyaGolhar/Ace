import { expect, type Page } from '@playwright/test';
import { magicLinkFor } from './support/apiServer';

/** Reads every row of an IndexedDB object store in the app's database (for assertions only). */
export async function readStore<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (storeName) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('recall');
        open.onerror = () => {
          reject(new Error('open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          req.onsuccess = () => {
            resolve(req.result as T[]);
            db.close();
          };
          req.onerror = () => {
            reject(new Error('read failed'));
          };
        };
      }),
    store,
  );
}

export interface StoredLog {
  id: string;
  cardId: string;
  rating: number;
  reviewedAt: number;
  voidedAt: number | null;
}

export interface StoredState {
  cardId: string;
  due: number;
  state: string;
}

/** Creates a deck through the UI and returns to its deck page. */
export async function createDeck(page: Page, name: string): Promise<void> {
  await page.goto('/decks/new');
  await page.getByLabel('Deck name').fill(name);
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Adds cards through the card editor with "Save & add another", starting from the deck page. */
export async function addCards(
  page: Page,
  cards: { front: string; back: string }[],
): Promise<void> {
  await page.getByRole('link', { name: 'Add card' }).click();
  for (const [i, card] of cards.entries()) {
    await page.getByLabel('Question').fill(card.front);
    await page.getByLabel('Answer').fill(card.back);
    await page.getByRole('button', { name: 'Save & add another' }).click();
    await expect(page.getByTestId('added-status')).toContainText(
      `${String(i + 1)} ${i === 0 ? 'card' : 'cards'} added to`,
    );
  }
  // The form is empty again, so this just closes and returns to the deck.
  await page.getByRole('button', { name: 'Save and close' }).click();
}

export function numberedCards(n: number, prefix = 'Q'): { front: string; back: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    front: `${prefix}${String(i + 1)} front`,
    back: `${prefix}${String(i + 1)} back`,
  }));
}

/**
 * Waits until the service worker is installed and active, then reloads once so it
 * controls the page (in "prompt" mode it doesn't claim the first page it was installed
 * from). After this, the app loads with no network, like any later visit.
 */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/**
 * Answers cards until the session is complete: the first rating of each new card comes
 * from `firstRating`, every later appearance (learning steps) is rated Easy.
 */
export async function finishSession(
  page: Page,
  firstRating: (index: number) => 'Again' | 'Hard' | 'Good' | 'Easy' = () => 'Easy',
): Promise<number> {
  const seen = new Set<string>();
  let ratings = 0;
  for (;;) {
    const complete = page.getByRole('heading', { name: 'Review complete' });
    const showAnswer = page.getByRole('button', { name: 'Show answer' });
    await expect(complete.or(showAnswer)).toBeVisible();
    if (await complete.isVisible()) return ratings;
    const front = await page.getByTestId('card-front').innerText();
    await showAnswer.click();
    const label = seen.has(front) ? 'Easy' : firstRating(seen.size);
    seen.add(front);
    await page.getByRole('button', { name: new RegExp(`^${label} ·`) }).click();
    ratings += 1;
    await expect(page.getByRole('button', { name: /^Easy ·/ })).toHaveCount(0);
  }
}

let counter = 0;
export function uniqueEmail(): string {
  counter += 1;
  return `e2e-${String(Date.now())}-${String(counter)}@example.com`;
}

/** Signs in through the UI and the real magic link (read from the API's dev outbox). */
export async function signIn(page: Page, email: string) {
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

export async function syncNow(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('main').getByTestId('sync-status')).toContainText('Synced');
}

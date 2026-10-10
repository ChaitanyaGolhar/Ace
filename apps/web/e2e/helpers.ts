import { expect, type Page } from '@playwright/test';

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
    await page.getByLabel('Front').fill(card.front);
    await page.getByLabel('Back').fill(card.back);
    await page.getByRole('button', { name: 'Save & add another' }).click();
    await expect(page.getByTestId('added-status')).toHaveText(
      `Card added (${String(i + 1)} so far)`,
    );
  }
  await page.getByRole('button', { name: 'Done' }).click();
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
    const complete = page.getByRole('heading', { name: 'Session complete' });
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

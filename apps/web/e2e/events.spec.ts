import { expect, test, type Page } from '@playwright/test';
import {
  addCards,
  createDeck,
  finishSession,
  numberedCards,
  readStore,
  signIn,
  uniqueEmail,
} from './helpers';

// M4 product events, one check per event, each driven through the real UI. Events are
// read back from the app's IndexedDB; none may contain card text.

interface StoredEvent {
  id: string;
  type: string;
  props: Record<string, unknown>;
  occurredAt: number;
  dirty: 0 | 1;
}

const events = (page: Page) => readStore<StoredEvent>(page, 'events');
const ofType = async (page: Page, type: string) =>
  (await events(page)).filter((e) => e.type === type);

async function expectNoCardText(page: Page, texts: string[]) {
  const all = JSON.stringify(await events(page));
  for (const text of texts) expect(all).not.toContain(text);
}

test('app_opened: once per app start', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await ofType(page, 'app_opened')).length).toBe(1);
  await page.reload();
  await expect.poll(async () => (await ofType(page, 'app_opened')).length).toBe(2);
  expect((await ofType(page, 'app_opened'))[0]?.props).toEqual({});
});

test('deck_added_prebuilt: from the welcome card and from Browse, with the deck id only', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add & start' }).click();
  await expect(page.getByTestId('card-front')).toBeVisible();
  expect((await ofType(page, 'deck_added_prebuilt')).map((e) => e.props)).toEqual([
    { prebuiltId: 'dbms-basics-v1' },
  ]);

  await page.goto('/browse');
  await page.getByRole('button', { name: 'Add DBMS Basics' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add a second copy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'DBMS Basics' })).toBeVisible();
  expect(await ofType(page, 'deck_added_prebuilt')).toHaveLength(2);
  // Copying 20 ready-made cards is not "creating" cards.
  expect(await ofType(page, 'card_created')).toHaveLength(0);
});

test('card_created: one per card saved in the editor, without its text', async ({ page }) => {
  const cards = [
    { front: 'Secret question one', back: 'Secret answer one' },
    { front: 'Secret question two', back: 'Secret answer two' },
  ];
  await createDeck(page, 'Private deck');
  await addCards(page, cards);
  const created = await ofType(page, 'card_created');
  expect(created).toHaveLength(2);
  expect(created.map((e) => e.props)).toEqual([{}, {}]);
  await expectNoCardText(page, [...cards.flatMap((c) => [c.front, c.back]), 'Private deck']);
});

test('session_started: when a session starts (all decks or one deck), not on reload', async ({
  page,
}) => {
  await createDeck(page, 'Deck');
  await addCards(page, numberedCards(3));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start reviewing' }).click();
  await expect(page.getByTestId('card-front')).toBeVisible();
  await page.reload(); // the same session continues
  await expect(page.getByTestId('card-front')).toBeVisible();
  expect((await ofType(page, 'session_started')).map((e) => e.props)).toEqual([
    { scope: 'all', due: 0, new: 3 },
  ]);

  await page.getByRole('button', { name: 'End session' }).click();
  await page.goto('/decks');
  await page.getByRole('list', { name: 'Decks' }).getByRole('link').first().click();
  await page.getByRole('link', { name: 'Study deck' }).click();
  await expect(page.getByTestId('card-front')).toBeVisible();
  const started = await ofType(page, 'session_started');
  expect(started.map((e) => e.props.scope)).toEqual(['all', 'deck']);
});

test('first_review_completed: on the first rating ever, and only then', async ({ page }) => {
  await createDeck(page, 'Deck');
  await addCards(page, numberedCards(3));
  await page.getByRole('link', { name: 'Study deck' }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect.poll(async () => (await ofType(page, 'first_review_completed')).length).toBe(1);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect(page.getByTestId('position')).toContainText('3');
  expect(await ofType(page, 'first_review_completed')).toHaveLength(1);
});

test('session_completed: finishing every card, then "Back to home"', async ({ page }) => {
  await createDeck(page, 'Deck');
  await addCards(page, numberedCards(2));
  await page.getByRole('link', { name: 'Study deck' }).click();
  expect(await finishSession(page, () => 'Easy')).toBe(2);
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const done = await ofType(page, 'session_completed');
  expect(done).toHaveLength(1);
  expect(done[0]?.props.reviewed).toBe(2);
  expect(done[0]?.props.durationMs).toEqual(expect.any(Number));
  expect(await ofType(page, 'session_abandoned')).toHaveLength(0);
});

test('session_abandoned: leaving with ✕ while cards remain', async ({ page }) => {
  await createDeck(page, 'Deck');
  await addCards(page, numberedCards(3));
  await page.getByRole('link', { name: 'Study deck' }).click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect(page.getByTestId('position')).toContainText('2');
  await page.getByRole('button', { name: 'End session' }).click();
  await expect.poll(async () => (await ofType(page, 'session_abandoned')).length).toBe(1);
  expect((await ofType(page, 'session_abandoned'))[0]?.props).toEqual({
    reviewed: 1,
    remaining: 2,
  });
  expect(await ofType(page, 'session_completed')).toHaveLength(0);
});

test('signed_in: once when signing in, and every event then syncs to the server', async ({
  page,
}) => {
  await createDeck(page, 'Deck');
  await addCards(page, numberedCards(1));
  await signIn(page, uniqueEmail());
  await expect.poll(async () => (await ofType(page, 'signed_in')).length).toBe(1);
  await page.reload(); // still signed in: no second event
  await expect(page.getByText(/^Signed in as /)).toBeVisible();
  expect(await ofType(page, 'signed_in')).toHaveLength(1);
  // Synced: nothing left to push.
  await expect.poll(async () => (await events(page)).filter((e) => e.dirty === 1).length).toBe(0);
});

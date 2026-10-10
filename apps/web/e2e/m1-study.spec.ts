import { expect, test } from '@playwright/test';
import { formatInterval } from '../src/services/format';
import {
  addCards,
  createDeck,
  numberedCards,
  readStore,
  type StoredLog,
  type StoredState,
} from './helpers';

const LABELS = ['Again', 'Hard', 'Good', 'Easy'] as const;

test('create a deck, add 10 cards and study them; each rating schedules what its button previewed', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Remember what you study.' })).toBeVisible();

  await createDeck(page, 'Biology');
  await addCards(page, numberedCards(10));
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('listitem')).toHaveCount(10);

  await page.goto('/');
  await expect(page.getByTestId('count-new')).toHaveText('10');
  await page.getByRole('button', { name: 'Start reviewing' }).click();

  const seen = new Set<string>();
  let checked = 0;
  for (;;) {
    const complete = page.getByRole('heading', { name: 'Review complete' });
    const showAnswer = page.getByRole('button', { name: 'Show answer' });
    await expect(complete.or(showAnswer)).toBeVisible();
    if (await complete.isVisible()) break;

    const front = await page.getByTestId('card-front').innerText();
    await showAnswer.click();
    // First time a card appears: cycle through all four ratings. Learning-step repeats: Easy.
    const label = seen.has(front) ? 'Easy' : (LABELS[seen.size % 4] ?? 'Easy');
    seen.add(front);
    const button = page.getByRole('button', { name: new RegExp(`^${label} · `) });
    const previewed = ((await button.getAttribute('aria-label')) ?? '').split(' · ')[1];
    const logsBefore = (await readStore<StoredLog>(page, 'reviewLogs')).length;
    await button.click();

    // Find the log just written, then the card's stored state.
    await expect
      .poll(async () => (await readStore<StoredLog>(page, 'reviewLogs')).length)
      .toBe(logsBefore + 1);
    const logs = await readStore<StoredLog>(page, 'reviewLogs');
    const log = logs.sort((a, b) => b.reviewedAt - a.reviewedAt || (b.id > a.id ? 1 : -1))[0];
    if (!log) throw new Error('no log');
    const state = (await readStore<StoredState>(page, 'cardStates')).find(
      (s) => s.cardId === log.cardId,
    );
    if (!state) throw new Error('no state');
    expect(formatInterval(state.due - log.reviewedAt)).toBe(previewed);
    checked += 1;
  }

  expect(seen.size).toBe(10);
  expect(checked).toBeGreaterThanOrEqual(10);
  await expect(page.getByTestId('completion-text')).toContainText(
    `You reviewed ${String(checked)} cards`,
  );
  await page.getByRole('button', { name: 'Back to home' }).click();
  await expect(page.getByTestId('caught-up')).toBeVisible();
});

test('keyboard-only review: Space starts and shows the answer, 1–4 rate, Z undoes', async ({
  page,
}) => {
  await createDeck(page, 'Keys');
  await addCards(page, numberedCards(3, 'K'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start reviewing' })).toBeVisible();
  await page.keyboard.press('Space'); // starts reviewing from Home

  const front = page.getByTestId('card-front');
  await expect(front).toHaveText('K1 front');
  await expect(page.getByTestId('card-kind')).toHaveText('New');
  await expect(page.getByTestId('first-card-hint')).toHaveText(
    'Try to recall the answer, then tap Show answer.',
  );

  await page.keyboard.press('Space');
  await expect(page.getByTestId('card-back')).toHaveText('K1 back');
  await expect(page.getByTestId('announcer')).toHaveText('Answer shown');

  await page.keyboard.press('4');
  await expect(front).toHaveText('K2 front');
  await expect(page.getByTestId('card-back')).toHaveCount(0);
  await expect(page.getByTestId('undo-pill')).toHaveText('Undo · previous card was Easy');

  await page.keyboard.press('z');
  await expect(front).toHaveText('K1 front');
  await expect(page.getByTestId('card-back')).toHaveCount(0);
  const logs = await readStore<StoredLog>(page, 'reviewLogs');
  expect(logs).toHaveLength(1);
  expect(logs[0]?.voidedAt).not.toBeNull();

  for (const expected of ['K1', 'K2', 'K3']) {
    await expect(front).toHaveText(`${expected} front`);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('card-back')).toBeVisible();
    await page.keyboard.press('4');
  }
  await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
  await expect(page.getByTestId('completion-text')).toContainText('You reviewed 3 cards');
});

test('undo restores the previous due date exactly, also from the completion screen', async ({
  page,
}) => {
  await createDeck(page, 'Undo');
  await addCards(page, [
    { front: 'A', back: 'a' },
    { front: 'B', back: 'b' },
  ]);
  await page.getByRole('link', { name: 'Study deck' }).click();
  const front = page.getByTestId('card-front');

  // A and B: Good puts each into learning (due in 10 minutes).
  for (const name of ['A', 'B']) {
    await expect(front).toHaveText(name);
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: /^Good · / }).click();
  }
  // Nothing is due now, so A comes back early (learn-ahead).
  await expect(front).toHaveText('A');
  const cards = await readStore<{ id: string; front: string }>(page, 'cards');
  const aId = cards.find((c) => c.front === 'A')?.id;
  const bId = cards.find((c) => c.front === 'B')?.id;
  const stateOf = (id: string | undefined) => async () =>
    (await readStore<StoredState>(page, 'cardStates')).find((s) => s.cardId === id);
  const beforeA = await stateOf(aId)();

  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect(front).toHaveText('B');
  expect((await stateOf(aId)())?.due).not.toBe(beforeA?.due);

  await page.getByTestId('undo-pill').click();
  await expect(front).toHaveText('A');
  await expect.poll(stateOf(aId)).toEqual(beforeA);

  // Finish, then undo the last rating from the completion screen.
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect(front).toHaveText('B');
  const beforeB = await stateOf(bId)();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Easy · / }).click();
  await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo last rating' }).click();
  await expect(front).toHaveText('B');
  await expect.poll(stateOf(bId)).toEqual(beforeB);
});

test('deleting a card shows an undo toast; Undo keeps it, letting it time out deletes it', async ({
  page,
}) => {
  await createDeck(page, 'Toast');
  await addCards(page, [
    { front: 'keep me', back: 'a' },
    { front: 'delete me', back: 'b' },
  ]);
  const list = page.getByRole('list', { name: 'Cards' });

  await page.getByRole('button', { name: 'Card options: keep me' }).click();
  await page.getByRole('menuitem', { name: 'Delete card' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Card options: delete me' }).click();
  await page.getByRole('menuitem', { name: 'Delete card' }).click();
  await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 8000 });
  const cards = await readStore<{ front: string; deletedAt: number | null }>(page, 'cards');
  expect(cards.find((c) => c.front === 'delete me')?.deletedAt).not.toBeNull();
  expect(cards.find((c) => c.front === 'keep me')?.deletedAt).toBeNull();
});

test('rename a deck, edit a card, search, and delete the deck after confirming', async ({
  page,
}) => {
  await createDeck(page, 'Old name');
  await addCards(page, [
    { front: 'alpha', back: 'one' },
    { front: 'beta', back: 'two' },
  ]);

  await page.getByRole('button', { name: 'Deck options' }).click();
  await page.getByRole('menuitem', { name: 'Rename deck' }).click();
  await page.getByRole('dialog').getByLabel('Deck name').fill('New name');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New name' })).toBeVisible();

  await page.getByRole('button', { name: 'Card options: alpha' }).click();
  await page.getByRole('menuitem', { name: 'Edit card' }).click();
  await page.getByLabel('Answer').fill('ONE');
  await page.getByLabel('Answer').press('Control+Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'New name' })).toBeVisible();

  await page.getByLabel('Search cards').fill('ONE');
  await expect(page.getByRole('list', { name: 'Cards' }).getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Search cards').fill('zzz');
  await expect(page.getByTestId('search-empty')).toBeVisible();

  await page.getByRole('button', { name: 'Deck options' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck…' }).click();
  await page.getByRole('button', { name: 'Keep deck' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Deck options' }).click();
  await page.getByRole('menuitem', { name: 'Delete deck…' }).click();
  await page.getByRole('button', { name: 'Delete deck', exact: true }).click();
  await expect(page.getByTestId('decks-empty')).toBeVisible();
});

test('leaving the card editor with unsaved text asks first', async ({ page }) => {
  await createDeck(page, 'Guard');
  await page.getByRole('link', { name: 'Add card' }).click();
  await page.getByLabel('Question').fill('half-typed');
  await page.getByRole('link', { name: 'Decks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard this card?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Question')).toHaveValue('half-typed');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page
    .getByRole('dialog', { name: 'Discard this card?' })
    .getByRole('button', { name: 'Discard' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Guard' })).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';
import { createDeck, readStore, signIn, uniqueEmail, waitForServiceWorker } from './helpers';

// M6 question types end to end (BUILD_BRIEF_M6_M8 §6.3–6.7): each type is created in
// the editor, reviewed through the real UI, and the right rating and outcome recorded.

interface Log {
  id: string;
  cardId: string;
  rating: number;
  voidedAt: number | null;
  outcome: unknown;
}

const logs = (page: Page) => readStore<Log>(page, 'reviewLogs');
const liveLogs = async (page: Page) => (await logs(page)).filter((l) => l.voidedAt === null);

async function chooseType(page: Page, label: string) {
  await page
    .getByRole('radiogroup', { name: 'Card type' })
    .getByRole('radio', { name: label })
    .click();
}

async function saveAndClose(page: Page) {
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.getByRole('link', { name: 'Study deck' })).toBeVisible();
}

async function addMcq(page: Page, question: string, options: string[], correct: number) {
  await page.getByRole('link', { name: 'Add card' }).click();
  await chooseType(page, 'Multiple choice');
  await page.getByLabel('Question', { exact: true }).fill(question);
  for (let i = 2; i < options.length; i++)
    await page.getByRole('button', { name: 'Add option' }).click();
  for (const [i, text] of options.entries()) {
    await page.getByLabel(`Option ${'ABCDEF'[i] ?? ''}`, { exact: true }).fill(text);
  }
  await page.getByLabel(`Option ${'ABCDEF'[correct] ?? ''} is correct`).check();
  await page.getByLabel('Explanation (optional)').fill('It is unique and never null.');
  await saveAndClose(page);
}

async function addCloze(page: Page, sentence: string, accepted: string[] = []) {
  await page.getByRole('link', { name: 'Add card' }).click();
  await chooseType(page, 'Fill in the blank');
  await page.getByLabel('Sentence').fill(sentence);
  for (const [i, a] of accepted.entries()) {
    await page.getByRole('button', { name: 'Add accepted answer' }).click();
    await page.getByLabel(`Accepted answer ${String(i + 1)}`, { exact: true }).fill(a);
  }
  await saveAndClose(page);
}

async function addShort(page: Page, question: string, answer: string) {
  await page.getByRole('link', { name: 'Add card' }).click();
  await chooseType(page, 'Short answer');
  await page.getByLabel('Question', { exact: true }).fill(question);
  await page.getByLabel('Model answer').fill(answer);
  await page.getByLabel('Explanation (optional)').fill('Also called a virtual table.');
  await saveAndClose(page);
}

async function addLong(page: Page, question: string, points: string[], marks: string) {
  await page.getByRole('link', { name: 'Add card' }).click();
  await chooseType(page, 'Long answer');
  await page.getByLabel('Question', { exact: true }).fill(question);
  await page.getByLabel('Marks (optional)').fill(marks);
  for (let i = 2; i < points.length; i++)
    await page.getByRole('button', { name: 'Add key point' }).click();
  for (const [i, p] of points.entries()) {
    await page.getByLabel(`Key point ${String(i + 1)}`, { exact: true }).fill(p);
  }
  await saveAndClose(page);
}

const ratingGroup = (page: Page) => page.getByRole('group', { name: 'Rate your recall' });

async function startStudy(page: Page) {
  await page.getByRole('link', { name: 'Study deck' }).click();
  await expect(page.getByTestId('card-front')).toBeVisible();
}

test('multiple choice: a wrong choice can only Continue (= Again); a right one offers Hard/Good/Easy', async ({
  page,
}) => {
  await createDeck(page, 'MCQ');
  await addMcq(page, 'Which key identifies a row?', ['Foreign key', 'Primary key', 'Super key'], 1);
  await addMcq(page, 'Which normal form removes partial dependencies?', ['1NF', '2NF', '3NF'], 1);
  await startStudy(page);

  await expect(page.getByTestId('card-type')).toHaveText('Multiple choice');
  await expect(page.getByRole('button', { name: 'Check' })).toBeDisabled();
  await page.getByRole('radio', { name: /^A\. Foreign key/ }).click();
  await page.getByRole('button', { name: 'Check' }).click();

  // ✓ and ✗ are words as well as colours.
  await expect(page.getByTestId('option-b')).toContainText('Correct answer');
  await expect(page.getByTestId('option-a')).toContainText('Your answer');
  await expect(page.getByTestId('card-explanation')).toHaveText('It is unique and never null.');
  await expect(ratingGroup(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('card-front')).toHaveText(/partial dependencies/);
  let recorded = await liveLogs(page);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    rating: 1,
    outcome: { kind: 'mcq', selected: 'a', correct: false },
  });

  // Keyboard: 2 selects B, Enter checks, then only 2–4 rate (no Again).
  await page.keyboard.press('2');
  await expect(page.getByRole('radio', { name: /^B\. 2NF/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('option-b')).toContainText('Correct answer');
  await expect(ratingGroup(page).getByRole('button')).toHaveCount(3);
  await expect(ratingGroup(page).getByRole('button', { name: /^Again/ })).toHaveCount(0);
  await page.keyboard.press('3');
  await expect.poll(async () => (await liveLogs(page)).length).toBe(2);
  recorded = await liveLogs(page);
  expect(recorded.find((l) => l.rating === 3)?.outcome).toEqual({
    kind: 'mcq',
    selected: 'b',
    correct: true,
  });
});

test('fill in the blank: typed right → 2–4; typed wrong → shows both and Continue; revealed → 1–4', async ({
  page,
}) => {
  await createDeck(page, 'Cloze');
  await addCloze(page, 'A {{primary key}} uniquely identifies each row.', ['pk']);
  await addCloze(page, 'A {{foreign key}} references another table.');
  await addCloze(page, 'SQL stands for {{Structured Query Language}}.');
  await startStudy(page);

  // 1: typed, right (case and the full stop don't matter), Enter checks while typing.
  await expect(page.getByTestId('card-type')).toHaveText('Fill in the blank');
  await page.getByLabel('Your answer').fill('Primary Key.');
  await page.getByLabel('Your answer').press('Enter');
  await expect(page.getByTestId('cloze-result')).toContainText('Correct');
  await expect(ratingGroup(page).getByRole('button')).toHaveCount(3);
  await ratingGroup(page).getByRole('button', { name: /^Good/ }).click();

  // 2: typed, wrong.
  await expect(page.getByTestId('card-front')).toHaveText(/references another table/);
  await page.getByLabel('Your answer').fill('primary key');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('cloze-result')).toContainText('Not quite');
  await expect(page.getByTestId('cloze-result')).toContainText('Answer: foreign key');
  await expect(page.getByTestId('cloze-result')).toContainText('You typed: primary key');
  await page.getByRole('button', { name: 'Continue' }).click();

  // 3: revealed without typing → all four.
  await expect(page.getByTestId('card-front')).toHaveText(/SQL stands for/);
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByTestId('card-front')).toContainText('Structured Query Language');
  await expect(ratingGroup(page).getByRole('button')).toHaveCount(4);
  await ratingGroup(page).getByRole('button', { name: /^Hard/ }).click();

  await expect.poll(async () => (await liveLogs(page)).length).toBe(3);
  const outcomes = (await liveLogs(page)).map((l) => [l.rating, l.outcome]);
  expect(outcomes).toEqual(
    expect.arrayContaining([
      [3, { kind: 'cloze', mode: 'typed', correct: true }],
      [1, { kind: 'cloze', mode: 'typed', correct: false }],
      [2, { kind: 'cloze', mode: 'revealed', correct: null }],
    ]),
  );
  // What was typed is never stored.
  expect(JSON.stringify(await logs(page))).not.toMatch(/primary key|Primary Key/);
});

test('short answer: the optional answer box, then the model answer; typed text is never saved', async ({
  page,
}) => {
  await createDeck(page, 'Short');
  await addShort(page, 'What is a view?', 'A stored query.');
  await startStudy(page);

  await expect(page.getByTestId('card-type')).toHaveText('Short answer');
  const toggle = page.getByRole('button', { name: 'Type your answer (optional)' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.getByLabel('Your answer (not saved)').fill('my secret attempt');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByTestId('card-back')).toHaveText('A stored query.');
  await expect(page.getByTestId('card-explanation')).toHaveText('Also called a virtual table.');
  await ratingGroup(page).getByRole('button', { name: /^Good/ }).click();

  await expect.poll(async () => (await liveLogs(page)).length).toBe(1);
  expect((await liveLogs(page))[0]).toMatchObject({ rating: 3, outcome: null });
  const everything = JSON.stringify([
    await logs(page),
    await readStore(page, 'events'),
    await readStore(page, 'cards'),
  ]);
  expect(everything).not.toContain('my secret attempt');
});

test('long answer: ticking key points moves the highlighted suggestion; any rating can be chosen', async ({
  page,
}) => {
  await createDeck(page, 'Long');
  await addLong(
    page,
    'Explain the ACID properties.',
    ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
    '6',
  );
  await startStudy(page);

  await expect(page.getByTestId('card-type')).toHaveText('Long answer');
  await expect(page.getByText('6 marks')).toBeVisible();
  await page.keyboard.press('Space'); // Show key points
  const points = page.getByTestId('key-points');
  await expect(points.getByRole('checkbox')).toHaveCount(4);
  await expect(page.getByTestId('suggestion')).toHaveText(/0 of 4 key points · Suggested: Again/);

  await points.getByRole('checkbox', { name: 'Atomicity' }).check();
  await page.keyboard.press('2'); // toggles key point 2
  await page.keyboard.press('3');
  await expect(page.getByTestId('suggestion')).toHaveText(/3 of 4 key points · Suggested: Good/);
  const suggested = ratingGroup(page).locator('[data-suggested="true"]');
  await expect(suggested).toHaveCount(1);
  await expect(suggested).toHaveAccessibleName(/^Good · .* · suggested$/);
  await expect(suggested).toContainText('Suggested');
  await expect(suggested).toContainText(/\d+(m|h|d|mo|y)/); // the interval stays visible

  await points.getByRole('checkbox', { name: 'Isolation' }).uncheck();
  await expect(page.getByTestId('suggestion')).toHaveText(/2 of 4 key points · Suggested: Hard/);
  await expect(ratingGroup(page).locator('[data-suggested="true"]')).toHaveAccessibleName(/^Hard/);

  // The user can pick any rating, not only the suggestion.
  await ratingGroup(page).getByRole('button', { name: /^Easy/ }).click();
  await expect.poll(async () => (await liveLogs(page)).length).toBe(1);
  expect((await liveLogs(page))[0]).toMatchObject({
    rating: 4,
    outcome: { kind: 'long', hit: 2, total: 4, suggested: 2 },
  });
});

test('undo brings a typed card back as it was answered, so it can be re-rated', async ({
  page,
}) => {
  await createDeck(page, 'Undo typed');
  await addMcq(page, 'Pick B', ['A', 'B'], 1);
  await addMcq(page, 'Pick A', ['A', 'B'], 0);
  await startStudy(page);

  await page.getByRole('radio', { name: /^A\. A/ }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('card-front')).toHaveText('Pick A');

  await page.keyboard.press('z');
  await expect(page.getByTestId('card-front')).toHaveText('Pick B');
  await expect(page.getByTestId('option-a')).toContainText('Your answer');
  await expect(page.getByTestId('option-b')).toContainText('Correct answer');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  const all = await logs(page);
  expect(all).toHaveLength(2);
  expect(all.filter((l) => l.voidedAt !== null)).toHaveLength(1);
});

test('editor: Save waits for a valid card; errors appear next to the field; a type change asks first', async ({
  page,
}) => {
  await createDeck(page, 'Editor');
  await page.getByRole('link', { name: 'Add card' }).click();
  await chooseType(page, 'Multiple choice');
  const save = page.getByRole('button', { name: 'Save & add another' });
  await expect(save).toBeDisabled();

  await page.getByLabel('Question', { exact: true }).fill('Q?');
  await page.getByLabel('Option A', { exact: true }).fill('Same');
  await page.getByLabel('Option B', { exact: true }).fill('same');
  await expect(page.getByText('Options must all be different.')).toBeVisible();
  await page.getByLabel('Option B', { exact: true }).fill('Other');
  await expect(page.getByText('Options must all be different.')).toHaveCount(0);
  await expect(save).toBeDisabled(); // no correct option yet
  await page.getByLabel('Option B is correct').check();
  await expect(save).toBeEnabled();

  // Switching to Short answer would clear the options: confirm first, keep by default.
  await chooseType(page, 'Short answer');
  const dialog = page.getByRole('dialog', { name: 'Change to Short answer?' });
  await expect(dialog).toContainText('Options will be cleared.');
  await expect(dialog.getByRole('button', { name: /^Keep/ })).toBeFocused();
  await dialog.getByRole('button', { name: /^Keep/ }).click();
  await expect(page.getByLabel('Option A', { exact: true })).toHaveValue('Same');

  await chooseType(page, 'Short answer');
  await page.getByRole('dialog').getByRole('button', { name: 'Change type' }).click();
  // By role: React mounts a textarea with its value as text content, which Playwright's
  // label matching would count as part of the label ("QuestionQ?").
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Q?');
  await expect(page.getByLabel('Model answer')).toHaveValue('');

  // Cloze: exactly one {{blank}}.
  await chooseType(page, 'Fill in the blank');
  await page.getByLabel('Sentence').fill('No blank here');
  await page.getByLabel('Sentence').blur();
  await expect(
    page.getByText('Wrap the answer in {{double braces}} — exactly one blank.'),
  ).toBeVisible();
  await page.getByLabel('Sentence').fill('One {{blank}} here');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByTestId('added-status')).toContainText('1 card added to Editor');
  const cards = await readStore<{ type: string; content: unknown }>(page, 'cards');
  expect(cards.map((c) => c.type)).toEqual(['cloze']);
});

test('offline: create typed cards and review them with no connection', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  await context.setOffline(true);
  await page.reload();

  await createDeck(page, 'Offline types');
  await addMcq(page, 'Offline MCQ', ['Yes', 'No'], 0);
  await addLong(page, 'Offline long', ['One', 'Two'], '2');
  await startStudy(page);

  await page.getByRole('radio', { name: /^A\. Yes/ }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await ratingGroup(page).getByRole('button', { name: /^Good/ }).click();
  await expect(page.getByTestId('card-front')).toHaveText('Offline long');
  await page.getByRole('button', { name: 'Show key points' }).click();
  await page.getByTestId('key-points').getByRole('checkbox', { name: 'One' }).check();
  await page.keyboard.press('Enter'); // rate with the suggestion (50% → Hard)

  await expect.poll(async () => (await liveLogs(page)).length).toBe(2);
  expect((await liveLogs(page)).map((l) => [l.rating, l.outcome])).toEqual(
    expect.arrayContaining([
      [3, { kind: 'mcq', selected: 'a', correct: true }],
      [2, { kind: 'long', hit: 1, total: 2, suggested: 2 }],
    ]),
  );
  await context.setOffline(false);
});

test('426: an outdated app shows "Update required to sync" and stops retrying; studying goes on', async ({
  page,
}) => {
  await createDeck(page, 'Old app');
  await signIn(page, uniqueEmail());
  let pushes = 0;
  await page.route('**/sync/push', async (route) => {
    pushes += 1;
    await route.fulfill({
      status: 426,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'upgrade_required', message: 'Out of date' } }),
    });
  });
  // Make a change so there is something to push.
  await page.goto('/decks');
  await createDeck(page, 'Something to push');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();

  const banner = page.getByTestId('update-banner');
  await expect(banner).toContainText('Update required to sync');
  await expect(banner.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(page.getByRole('main').getByTestId('sync-status')).toContainText(
    'Update required to sync',
  );

  // No retry loop: the first backoff would be 5 s.
  const after = pushes;
  await page.waitForTimeout(6500);
  expect(pushes).toBe(after);

  // Studying is unaffected.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

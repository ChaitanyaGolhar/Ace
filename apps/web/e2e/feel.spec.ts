import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BREAK_DECK, breakFront, buildBreakBackup, FEEL_DECK } from './fixtures/breakBackup';
import { readStore, type StoredLog, type StoredState } from './helpers';

// Feel pass: answer feedback, session complete, and coming back after a break. Motion is
// CSS only and never holds anything up; with reduced motion every transition is instant.

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });

interface StoredCard {
  id: string;
  front: string;
}
interface StoredEvent {
  type: string;
  props: Record<string, unknown>;
}

async function importBreakBackup(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Backup file to import').setInputFiles({
    name: 'break.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildBreakBackup(Date.now()))),
  });
  await expect(page.getByTestId('toast')).toContainText('Backup imported');
}

async function studyDeck(page: Page, name: string) {
  await page.goto('/decks');
  await page
    .getByRole('list', { name: 'Decks' })
    .getByRole('link', { name: new RegExp(name) })
    .click();
  await page.getByRole('link', { name: 'Study deck' }).click();
}

/** Fronts of the non-undone reviews, oldest first, with their ratings. */
async function reviewsInOrder(page: Page): Promise<{ front: string; rating: number }[]> {
  const cards = new Map(
    (await readStore<StoredCard>(page, 'cards')).map((c) => [c.id, c.front] as const),
  );
  return (await readStore<StoredLog>(page, 'reviewLogs'))
    .filter((l) => l.voidedAt === null && l.reviewedAt > Date.now() - 3_600_000)
    .sort((a, b) => a.reviewedAt - b.reviewedAt)
    .map((l) => ({ front: cards.get(l.cardId) ?? '?', rating: l.rating }));
}

async function eventsOf(page: Page, type: string) {
  return (await readStore<StoredEvent>(page, 'events')).filter((e) => e.type === type);
}

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  ).toEqual([]);
}

const check = async (page: Page, option: string) => {
  await page.getByTestId(`option-${option}`).click();
  await page.getByRole('button', { name: 'Check' }).click();
};
const typeCloze = async (page: Page, text: string) => {
  await page.getByLabel('Your answer').fill(text);
  await page.getByLabel('Your answer').press('Enter');
};
const rate = (page: Page, label: string) =>
  page
    .getByRole('group', { name: 'Rate your recall' })
    .getByRole('button', { name: new RegExp(`^${label} · `) })
    .click();

test('rating 10 cards quickly with the keyboard records all 10, in order (no animation holds a card)', async ({
  page,
}) => {
  await importBreakBackup(page);
  await page.goto('/study');
  await expect(page.getByTestId('card-front')).toHaveText(breakFront(1));

  // As fast as keys go: no waiting for any card, answer or animation in between.
  const ratings = ['3', '4', '2', '3', '4', '2', '3', '4', '2', '3'];
  for (const r of ratings) {
    await page.keyboard.press(' ');
    await page.keyboard.press(r);
  }

  await expect(page.getByTestId('card-front')).toHaveText(breakFront(11));
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
  await expect(page.getByTestId('position')).toHaveText(/^11 of /);
  expect(await reviewsInOrder(page)).toEqual(
    ratings.map((r, i) => ({ front: breakFront(i + 1), rating: Number(r) })),
  );
});

test('answer feedback: ✓ Correct with a small pop; ✗ "Not quite — here’s why." with no red flood', async ({
  page,
}) => {
  await importBreakBackup(page);
  await studyDeck(page, FEEL_DECK);

  // MCQ, right: the chosen option gets ✓ and the 180ms pop; "Correct" below.
  const optionB = page.getByTestId('option-b');
  const height = () => optionB.evaluate((el) => (el as HTMLElement).offsetHeight);
  const heightBefore = await height();
  await check(page, 'b');
  await expect(page.getByTestId('mcq-result')).toContainText('Correct');
  await expect(optionB).toContainText('Correct answer'); // icon + words for screen readers
  await expect(optionB).toHaveClass(/animate-pop/);
  // The ✓ slot is always there: marking the option doesn't reflow it.
  expect(await height()).toBe(heightBefore);
  await rate(page, 'Good');

  // MCQ, wrong: ✗ on the choice, ✓ on the answer, the explanation, neutral copy.
  await check(page, 'a');
  const result = page.getByTestId('mcq-result');
  await expect(result).toContainText('Not quite — here’s why.');
  await expect(result.getByTestId('card-explanation')).toContainText('TCP numbers');
  await expect(page.getByTestId('option-a')).toContainText('Your answer');
  await expect(page.getByTestId('option-b')).toContainText('Correct answer');
  await expect(page.getByTestId('option-a')).not.toHaveClass(/animate-pop/);
  const background = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await background('option-a')).toBe(await background('option-c'));
  // The verdict itself is in the text colour; only the ✗ icon is red.
  const verdictColour = await result
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  const textColour = await page.locator('body').evaluate((el) => getComputedStyle(el).color);
  expect(verdictColour).toBe(textColour);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Cloze, typed: the same pattern.
  await typeCloze(page, 'subnet mask');
  await expect(page.getByTestId('cloze-result')).toContainText('Correct');
  await expect(page.locator('[data-testid="card-front"] strong')).toHaveClass(/animate-pop/);
  await rate(page, 'Good');
  await typeCloze(page, 'host name');
  await expect(page.getByTestId('cloze-result')).toContainText('Not quite — here’s why.');
  await expect(page.getByTestId('cloze-result')).toContainText('Answer: domain name');
  await expect(page.getByTestId('card-explanation')).toContainText('Resolvers cache');
});

test('Show answer: the answer fades in below (150ms) without moving the question', async ({
  page,
}) => {
  await importBreakBackup(page);
  await page.goto('/study');
  const front = page.getByTestId('card-front');
  await expect(front).toHaveText(breakFront(1));
  // Once the card's own 120ms entrance is over.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const top = async () => (await front.boundingBox())?.y;
  const topBefore = await top();
  await page.getByRole('button', { name: 'Show answer' }).click();
  const revealed = page.getByTestId('card-back').locator('..');
  await expect(revealed).toHaveClass(/animate-reveal/);
  expect(
    await revealed.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.animationName, s.animationDuration];
    }),
  ).toEqual(['feel-in', '0.15s']);
  expect(await top()).toBe(topBefore);
});

test('reduced motion: every transition is instant, and the meaning is in icons and words', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importBreakBackup(page);
  await page.goto('/study');
  await page.getByRole('button', { name: 'Show answer' }).click();
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .map((el) => getComputedStyle(el))
      .filter((s) => s.animationName !== 'none' || s.transitionProperty !== 'all')
      .flatMap((s) => [
        ...s.animationDuration.split(','),
        ...s.animationDelay.split(','),
        ...s.transitionDuration.split(','),
        ...s.transitionDelay.split(','),
      ])
      .map((d) => d.trim()),
  );
  expect(new Set(durations)).toEqual(new Set(['0s']));
  await rate(page, 'Good');
  await expect(page.getByTestId('card-front')).toHaveText(breakFront(2));
});

test('session complete: the ring, and only true numbers', async ({ page }) => {
  await importBreakBackup(page);
  await studyDeck(page, FEEL_DECK);
  await check(page, 'b');
  await rate(page, 'Easy');
  await check(page, 'a'); // wrong: Continue = Again, it comes back
  await page.getByRole('button', { name: 'Continue' }).click();
  await typeCloze(page, 'subnet mask');
  await rate(page, 'Easy');
  await typeCloze(page, 'domain name');
  await rate(page, 'Easy');
  // The missed MCQ comes back (learning step); right this time.
  await check(page, 'b');
  await rate(page, 'Easy');

  await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
  await expect(page.locator('svg .draw-ring')).toHaveCount(1);
  await expect(page.locator('svg .draw-check')).toHaveCount(1);
  await expect(page.getByTestId('completion-text')).toContainText('You reviewed 5 cards');
  await expect(page.getByTestId('remembered')).toHaveText('Remembered 4 of 5');
  // The overdue Computer Networks cards are still due today (this was one deck).
  await expect(page.getByTestId('next-due')).toHaveText('Next: 45 still due today');

  // "won't come back for 2+ weeks": from the scheduler's states, shown only when true.
  const cards = await readStore<StoredCard & { deckId: string }>(page, 'cards');
  const feelIds = new Set(cards.filter((c) => !c.front.startsWith('CN ')).map((c) => c.id));
  const farOff = (await readStore<StoredState>(page, 'cardStates')).filter(
    (s) => feelIds.has(s.cardId) && s.due >= Date.now() + 14 * 86_400_000 - 60_000,
  ).length;
  if (farOff === 0) await expect(page.getByTestId('far-off')).toHaveCount(0);
  else {
    await expect(page.getByTestId('far-off')).toHaveText(
      `${String(farOff)} card${farOff === 1 ? '' : 's'} won’t come back for 2+ weeks.`,
    );
  }
  await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible();
});

test('coming back after a break: "Start with 20", capped, then "Do 20 more" or "Done for today"', async ({
  page,
}) => {
  await importBreakBackup(page);
  await page.goto('/');
  const panel = page.getByTestId('break-return');
  await expect(panel).toContainText('Welcome back.');
  await expect(panel).toContainText('45 cards are waiting — nothing is lost.');
  await expect(panel.getByRole('button', { name: 'Review all 45' })).toBeVisible();
  await page.reload();
  await expect(panel).toBeVisible();
  // Once per study day, numbers only.
  await expect.poll(() => eventsOf(page, 'break_return_shown')).toHaveLength(1);
  expect((await eventsOf(page, 'break_return_shown'))[0]?.props).toEqual({
    due: 45,
    daysAway: expect.any(Number) as unknown,
  });

  const before = new Map(
    (await readStore<StoredState>(page, 'cardStates')).map((s) => [s.cardId, s] as const),
  );
  await panel.getByRole('button', { name: 'Start with 20' }).click();
  await expect(page.getByTestId('position')).toHaveText('1 of 20');
  await expect(page.getByTestId('card-front')).toHaveText(breakFront(1));
  expect((await eventsOf(page, 'capped_session_started')).map((e) => e.props)).toEqual([
    { cap: 20, due: 45 },
  ]);

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(' ');
    await page.keyboard.press('3');
  }
  await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
  expect((await reviewsInOrder(page)).map((r) => r.front)).toEqual(
    Array.from({ length: 20 }, (_, i) => breakFront(i + 1)),
  );
  await expect(page.getByTestId('remembered')).toHaveText('Remembered 20 of 20');
  await expect(page.getByTestId('next-due')).toHaveText('Next: 25 still due today');
  const more = page.getByRole('button', { name: 'Do 20 more' });
  const done = page.getByRole('button', { name: 'Done for today' });
  await expect(more).toBeVisible();
  await expect(done).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to home' })).toHaveCount(0);
  // Neither is emphasised as the right choice.
  expect(await more.getAttribute('class')).toBe(await done.getAttribute('class'));
  await expectNoViolations(page);

  // The cap is a session limit only: the 25 cards it left out are exactly as they were.
  const reviewed = new Set(
    (await readStore<StoredLog>(page, 'reviewLogs'))
      .filter((l) => l.reviewedAt > Date.now() - 3_600_000)
      .map((l) => l.cardId),
  );
  const untouched = (await readStore<StoredState>(page, 'cardStates')).filter(
    (s) => !reviewed.has(s.cardId),
  );
  expect(untouched).toHaveLength(before.size - 20);
  for (const s of untouched) expect(s).toEqual(before.get(s.cardId));

  await more.click();
  await expect(page.getByTestId('position')).toHaveText('1 of 20');
  await expect(page.getByTestId('card-front')).toHaveText(breakFront(21));
  expect(await eventsOf(page, 'capped_session_started')).toHaveLength(2);
  expect(await eventsOf(page, 'session_completed')).toHaveLength(1);

  // Studied today: Home is the usual one again.
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('heading', { name: 'Today’s study' })).toBeVisible();
  await expect(page.getByTestId('break-return')).toHaveCount(0);
});

test('coming back after a break: "Review all" is the whole queue', async ({ page }) => {
  await importBreakBackup(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Review all 45' }).click();
  await expect(page.getByTestId('position')).toHaveText(/^1 of (\d+)$/);
  const total = Number((await page.getByTestId('position').innerText()).split(' of ')[1]);
  expect(total).toBeGreaterThanOrEqual(45);
  expect(await eventsOf(page, 'capped_session_started')).toHaveLength(0);
});

for (const theme of ['dark', 'light'] as const) {
  test(`axe · ${theme}: welcome back, answer feedback, session complete`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await importBreakBackup(page);
    await page.goto('/');
    await expect(page.getByTestId('break-return')).toBeVisible();
    await expectNoViolations(page);

    await studyDeck(page, FEEL_DECK);
    await check(page, 'b');
    await expectNoViolations(page);
    await rate(page, 'Easy');
    await check(page, 'a');
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await typeCloze(page, 'host name');
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await typeCloze(page, 'domain name');
    await rate(page, 'Easy');
    for (let i = 0; i < 4; i++) {
      const doneHeading = page.getByRole('heading', { name: 'Review complete' });
      const mcq = page.getByTestId('option-b');
      const cloze = page.getByRole('textbox', { name: 'Your answer' });
      await expect(doneHeading.or(mcq).or(cloze)).toBeVisible();
      if (await doneHeading.isVisible()) break;
      if (await mcq.isVisible()) await check(page, 'b');
      else await typeCloze(page, 'subnet mask');
      await rate(page, 'Easy');
      await expect(page.getByRole('group', { name: 'Rate your recall' })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
    await expectNoViolations(page);
  });
}

test(`${BREAK_DECK} fixture sanity: 45 overdue, studied weeks ago`, async ({ page }) => {
  await importBreakBackup(page);
  const states = await readStore<StoredState>(page, 'cardStates');
  expect(states.filter((s) => s.state === 'review' && s.due < Date.now())).toHaveLength(45);
});

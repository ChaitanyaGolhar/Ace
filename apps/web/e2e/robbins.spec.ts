import { expect, test, type Page } from '@playwright/test';
import { ROBBINS_SUBJECT, robbinsCatalogFile } from './fixtures/robbinsCatalog';
import { waitForServiceWorker } from './helpers';
import { publish, uniqueSlug } from './support/catalog';

// The Robbins ch. 3 deck (1,014 cards), bundled before M7 and now a store deck: its
// multi-line questions and bulleted answers on a 390 px phone in both themes, and, once
// added, studying it with no network at all.

test.beforeAll(() => {
  publish(robbinsCatalogFile(uniqueSlug('robbins-ch3')));
});

/** Adds Robbins from the store and opens its first card. */
async function addAndStartRobbins(page: Page) {
  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill('Robbins');
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: /Robbins Ch\. 3/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await page.getByRole('link', { name: 'Study deck' }).click();
}

/** The page doesn't scroll sideways, and the answer's last line clears the rating bar. */
async function expectLongCardScrolls(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.innerHeight); // it is long
  const rate = page.getByRole('group', { name: 'Rate your recall' });
  await expect(rate).toBeInViewport(); // the rating bar stays on screen

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const back = await page.getByTestId('card-back').boundingBox();
  const again = await page.getByRole('button', { name: /^Again · / }).boundingBox();
  if (!back || !again) throw new Error('missing boxes');
  // Scrolled to the end, the whole answer is above the sticky rating bar.
  expect(back.y + back.height).toBeLessThanOrEqual(again.y);
}

for (const theme of ['dark', 'light'] as const) {
  test(`Robbins cards on a 390 px phone (${theme}): line breaks, bullets, long cards scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await addAndStartRobbins(page);

    // Card 1, the longest in the deck: the options are on their own lines.
    const front = page.getByTestId('card-front');
    await expect(front).toContainText('Inflammation is best defined');
    const frontText = await front.innerText(); // rendered text: respects CSS white-space
    expect(frontText).toContain('response of:\n\nA. All tissues');
    expect(frontText).toContain('\nB. Vascularized tissues');
    expect(frontText).toContain('\nD. Epithelial tissues');
    await page.getByRole('button', { name: 'Show answer' }).click();
    expect(await page.getByTestId('card-back').innerText()).toMatch(/^B — Vascularized[^\n]*\n\n/);
    await expectLongCardScrolls(page);

    // Cards 1–12 rated Easy; card 13 is the first with a bulleted answer.
    await page.getByRole('button', { name: /^Easy · / }).click();
    for (let i = 2; i <= 12; i++) {
      await page.getByRole('button', { name: 'Show answer' }).click();
      await page.getByRole('button', { name: /^Easy · / }).click();
    }
    await expect(page.getByTestId('position')).toContainText('13 of');
    await page.getByRole('button', { name: 'Show answer' }).click();
    const back = await page.getByTestId('card-back').innerText();
    expect(back).toContain(
      'Key points:\n• Vascularized tissue response\n• Recruitment from circulation',
    );
  });
}

test('once added, the Robbins deck (1,014 cards) is studied fully offline', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  // Adding needs the network (§7.5); studying doesn't.
  await addAndStartRobbins(page);
  await expect(page.getByTestId('card-front')).toContainText('Inflammation is best defined');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('card-front')).toContainText('Inflammation is best defined');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good · / }).click();
  await expect(page.getByTestId('card-front')).toContainText(
    'Which statement regarding inflammation is correct?',
  );

  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' })).toContainText('1,014 cards');
  await expect(page.getByRole('list', { name: 'Decks' })).toContainText('From the store');
  await context.setOffline(false);
});

test('the store shows it under its subject', async ({ page }) => {
  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill('Pathology');
  await expect(page.getByRole('list', { name: 'Store decks' }).first()).toContainText(
    ROBBINS_SUBJECT,
  );
});

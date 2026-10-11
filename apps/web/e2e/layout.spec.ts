import { expect, test, type Page } from '@playwright/test';
import { buildSeedBackup } from './fixtures/seedBackup';
import { deckFile, publish, uniqueSlug } from './support/catalog';

// Phone layout guards (UI polish): at 390×844 no screen scrolls sideways, and every
// control is a ≥ 44px touch target. A control may look smaller when a ::before keeps its
// tap area 44px tall (the store's filter chips). Links inside a sentence are exempt
// (WCAG 2.5.8's inline exception).

const NOW = Date.parse('2026-10-10T03:30:00Z');
const SUBJECT = `Layout DBMS ${uniqueSlug('layout')}`;
const PAID = `Layout ML ${uniqueSlug('layout')}`;

test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kolkata' });

test.beforeAll(() => {
  publish(
    deckFile({
      slug: uniqueSlug('layout'),
      subject: SUBJECT,
      cards: [
        { key: 'u1-001', unit: 1, type: 'basic', front: 'What is a DBMS?', back: 'Software.' },
        {
          key: 'u1-002',
          unit: 1,
          type: 'mcq',
          question: 'Which key identifies a row?',
          options: [
            { id: 'a', text: 'Foreign key' },
            { id: 'b', text: 'Primary key' },
          ],
          correct: 'b',
        },
      ],
    }),
  );
  publish(
    deckFile({
      slug: uniqueSlug('layout-paid'),
      subject: PAID,
      price: 4900,
      cards: [{ key: 'u1-001', unit: 1, type: 'basic', front: 'Q', back: 'A' }],
    }),
  );
});

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/settings');
  await page.getByLabel('Backup file to import').setInputFiles({
    name: 'seed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(buildSeedBackup(NOW))),
  });
  await expect(page.getByTestId('toast')).toContainText('Backup imported');
});

interface Problem {
  what: string;
  height: number;
}

/** Sideways scroll, and visible controls shorter than 44px (by their tap area). */
async function layoutProblems(page: Page): Promise<{ overflow: number; small: Problem[] }> {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const controls = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea, summary, [role=radio], [role=tab]',
    );
    const small: { what: string; height: number }[] = [];
    for (const el of controls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // hidden
      if (el.closest('[aria-hidden="true"], .sr-only')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden') continue;
      // A link inside running text (its parent is a sentence, not a layout box).
      if (el.tagName === 'A' && style.display === 'inline') continue;
      const before = getComputedStyle(el, '::before');
      const tap =
        before.content !== 'none' && before.position === 'absolute'
          ? Math.max(rect.height, parseFloat(before.height) || 0)
          : rect.height;
      if (tap < 43.5) {
        const name = (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40);
        small.push({ what: `${el.tagName.toLowerCase()} "${name}"`, height: Math.round(tap) });
      }
    }
    return { overflow, small };
  });
}

async function expectPhoneLayout(page: Page, where: string) {
  const { overflow, small } = await layoutProblems(page);
  expect(overflow, `${where}: scrolls sideways`).toBeLessThanOrEqual(0);
  expect(small, `${where}: controls under 44px`).toEqual([]);
}

test('390px: no sideways scroll, 44px touch targets — main screens', async ({ page }) => {
  for (const [path, ready] of [
    ['/', 'Your decks'],
    ['/decks', 'Decks'],
    ['/stats', 'Stats'],
    ['/settings', 'Settings'],
    ['/store', 'Store'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
    await expectPhoneLayout(page, path);
  }
  await page.goto('/decks');
  await page.getByRole('list', { name: 'Decks' }).getByRole('link').first().click();
  await expect(page.getByRole('link', { name: 'Study deck' })).toBeVisible();
  await expectPhoneLayout(page, 'deck page');
  await page.goto('/search');
  await page.getByRole('searchbox').fill('a');
  await expectPhoneLayout(page, 'search');
});

test('390px: no sideways scroll, 44px touch targets — store deck pages and review', async ({
  page,
}) => {
  for (const subject of [SUBJECT, PAID]) {
    await page.goto('/store');
    await page.getByPlaceholder('Search subjects').fill(subject);
    await page
      .getByRole('list', { name: 'Store decks' })
      .getByRole('link', { name: new RegExp(subject) })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await expectPhoneLayout(page, subject);
  }
  await page.goto('/study');
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
  await expectPhoneLayout(page, 'review, question');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await expect(page.getByRole('group', { name: 'Rate your recall' })).toBeVisible();
  await expectPhoneLayout(page, 'review, answer');
  await page.getByRole('button', { name: /^Good · / }).click();
  await expect(page.getByTestId('undo-pill')).toBeVisible();
  await expectPhoneLayout(page, 'review, with undo');
});

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { BREAK_DECK, buildBreakBackup, FEEL_DECK } from './fixtures/breakBackup';

// Stills and short recordings of the three "feel" moments (FEEL_PASS_REPORT.md), into
// docs/ui-design/feel/<FEEL_DIR>/. Opt-in:
//   FEEL_CAPTURE=1 FEEL_DIR=_after pnpm --filter @recall/web exec playwright test e2e/feel-capture.spec.ts
// Stills use reduced motion (the settled state); recordings play the motion at real speed.
test.skip(process.env.FEEL_CAPTURE !== '1', 'set FEEL_CAPTURE=1 to capture');

const DIR = process.env.FEEL_DIR ?? '_actual';
const OUT = join(import.meta.dirname, '..', '..', '..', 'docs', 'ui-design', 'feel', DIR);
const AFTER = DIR !== '_before';
const SIZE = { width: 390, height: 844 };

test.use({ viewport: SIZE, timezoneId: 'Asia/Kolkata' });
test.setTimeout(240_000);

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

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
  await page.getByRole('list', { name: 'Decks' }).getByRole('link', { name: new RegExp(name) }).click();
  await page.getByRole('link', { name: 'Study deck' }).click();
}

const pause = (page: Page, ms = 700) => page.waitForTimeout(ms);

async function check(page: Page, option: string) {
  await page.getByTestId(`option-${option}`).click();
  await page.getByRole('button', { name: 'Check' }).click();
}

async function typeCloze(page: Page, text: string) {
  await page.getByLabel('Your answer').fill(text);
  await page.getByLabel('Your answer').press('Enter');
}

async function next(page: Page) {
  const cont = page.getByRole('button', { name: 'Continue' });
  if (await cont.isVisible()) await cont.click();
  else await page.getByRole('button', { name: /^Good · / }).click();
}

/** The feel-check deck: MCQ right, MCQ wrong, cloze right, cloze wrong; `shot` after each check. */
async function answerFeelDeck(page: Page, shot: (name: string) => Promise<void>) {
  await studyDeck(page, FEEL_DECK);
  await check(page, 'b');
  await shot('mcq-correct');
  await next(page);
  await check(page, 'a');
  await shot('mcq-wrong');
  await next(page);
  await typeCloze(page, 'subnet mask');
  await shot('cloze-correct');
  await next(page);
  await typeCloze(page, 'host name');
  await shot('cloze-wrong');
  await next(page);
}

for (const theme of ['dark', 'light'] as const) {
  test(`stills, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const shot = async (name: string) => {
      await pause(page, 250);
      await page.screenshot({ path: join(OUT, `${name}-${theme}.png`) });
    };
    await importBreakBackup(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    await shot('home-after-break');

    await studyDeck(page, BREAK_DECK);
    await page.getByRole('button', { name: 'Show answer' }).click();
    await shot('basic-revealed');

    await answerFeelDeck(page, shot);
    // The two missed cards come back (learning steps); get them right this time.
    const done = page.getByRole('heading', { name: 'Review complete' });
    const mcq = page.getByTestId('option-b');
    const cloze = page.getByRole('textbox', { name: 'Your answer' });
    for (let i = 0; i < 8; i++) {
      await expect(done.or(mcq).or(cloze)).toBeVisible();
      if (await done.isVisible()) break;
      if (await mcq.isVisible()) await check(page, 'b');
      else {
        const front = await page.getByTestId('card-front').innerText();
        await typeCloze(page, front.includes('network part') ? 'subnet mask' : 'domain name');
      }
      await page.getByRole('button', { name: /^Easy · / }).click();
      await expect(page.getByRole('button', { name: /^Easy · / })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
    await shot('complete');

    if (AFTER) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Start with 20' }).click();
      await expect(page.getByTestId('position')).toHaveText('1 of 20');
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(' ');
        await page.keyboard.press('3');
      }
      await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
      await shot('capped-complete');
    }
  });
}

/** A recording of one moment, dark theme, motion on. */
async function record(browser: Browser, name: string, run: (page: Page) => Promise<void>) {
  const tmp = join(OUT, `.video-${name}`);
  const ctx = await browser.newContext({
    viewport: SIZE,
    timezoneId: 'Asia/Kolkata',
    colorScheme: 'dark',
    baseURL: 'http://localhost:4173',
    recordVideo: { dir: tmp, size: SIZE },
  });
  const page = await ctx.newPage();
  await importBreakBackup(page);
  const video = page.video();
  await run(page);
  await pause(page, 900);
  await ctx.close();
  await video?.saveAs(join(OUT, `${name}.webm`));
  rmSync(tmp, { recursive: true, force: true });
}

test('recordings', async ({ browser }) => {
  await record(browser, 'reveal-and-rate', async (page) => {
    await studyDeck(page, BREAK_DECK);
    for (let i = 0; i < 3; i++) {
      await pause(page);
      await page.getByRole('button', { name: 'Show answer' }).click();
      await pause(page);
      await page.getByRole('button', { name: /^Good · / }).click();
    }
  });
  await record(browser, 'answer-feedback', async (page) => {
    await answerFeelDeck(page, () => pause(page, 1200));
  });
  await record(browser, 'session-complete', async (page) => {
    await studyDeck(page, FEEL_DECK);
    await check(page, 'b');
    await page.getByRole('button', { name: /^Easy · / }).click();
    await check(page, 'b');
    await page.getByRole('button', { name: /^Easy · / }).click();
    await typeCloze(page, 'subnet mask');
    await page.getByRole('button', { name: /^Easy · / }).click();
    await typeCloze(page, 'domain name');
    await pause(page, 500);
    await page.getByRole('button', { name: /^Easy · / }).click();
    await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
    await pause(page, 1500);
  });
  await record(browser, 'break-return', async (page) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    await pause(page, 1500);
    if (!AFTER) return;
    await page.getByRole('button', { name: 'Start with 20' }).click();
    await expect(page.getByTestId('position')).toHaveText('1 of 20');
    await pause(page);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(' ');
      await pause(page, 120);
      await page.keyboard.press('3');
      await pause(page, 120);
    }
    await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
    await pause(page, 1500);
    await page.getByRole('button', { name: 'Do 20 more' }).click();
    await expect(page.getByTestId('position')).toHaveText('1 of 20');
    await pause(page, 1000);
  });
});

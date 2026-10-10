import { expect, test, type Page } from '@playwright/test';
import { readStore, waitForServiceWorker } from './helpers';
import { deckFile, publish, uniqueSlug, type CardJson } from './support/catalog';

// M7 deck store end to end (BUILD_BRIEF_M6_M8 §7.5–7.8), against the real API, with decks
// published through the owner's real CLI.

const basic = (key: string, unit: number, front: string): CardJson => ({
  key,
  unit,
  type: 'basic',
  front,
  back: `${front} — answer`,
});

function dbmsDeck(slug: string, subject: string, version = 1, cards?: CardJson[]) {
  return deckFile({
    slug,
    version,
    subject,
    branches: ['CSE', 'CSE-DS'],
    subjectCodes: { CSE: 'PCC301COM', 'CSE-DS': 'PCC301CDS' },
    cards: cards ?? [
      basic('u1-001', 1, 'What is a DBMS?'),
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
        explanation: 'Unique and not null.',
      },
      basic('u2-001', 2, 'What is a view?'),
    ],
  });
}

async function openInStore(page: Page, subject: string) {
  await page.goto('/store');
  await page.getByPlaceholder('Search subjects').fill(subject);
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
}

test('Store → filter → detail → preview a sample card → Add → study a card', async ({ page }) => {
  const subject = `Database Systems ${uniqueSlug('s')}`;
  const slug = uniqueSlug('dbms');
  publish(dbmsDeck(slug, subject));

  await page.goto('/');
  await page.getByRole('link', { name: 'Find your subject' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Store' })).toBeVisible();

  // Filters: TE, CSE-DS, then search; remembered on this device.
  await page.getByRole('group', { name: 'Year' }).getByRole('button', { name: 'TE' }).click();
  await page.getByRole('group', { name: 'Branch' }).getByRole('button', { name: 'CSE-DS' }).click();
  await page.getByPlaceholder('Search subjects').fill(subject);
  const rows = page.getByRole('list', { name: 'Store decks' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Units 1–2');
  await expect(rows.first()).toContainText('Free');
  await page.getByRole('group', { name: 'Year' }).getByRole('button', { name: 'BE' }).click();
  await expect(page.getByText('No decks match these filters.')).toBeVisible();
  await page.getByRole('group', { name: 'Year' }).getByRole('button', { name: 'TE' }).click();
  await rows.first().getByRole('link').click();

  // Detail: syllabus info, the CSE-DS subject code (filtered branch), units, samples.
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(page.getByText('PCC301CDS')).toBeVisible();
  await expect(page.getByText('PCC301COM')).toHaveCount(0);
  await expect(page.getByText('2024 pattern')).toBeVisible();
  const sample = page.getByTestId('sample-card').filter({ hasText: 'Which key identifies a row?' });
  await sample.getByRole('radio', { name: /^A\. Foreign key/ }).click();
  await sample.getByRole('button', { name: 'Check' }).click();
  await expect(sample.getByTestId('option-b')).toContainText('Correct answer');
  await sample.getByRole('button', { name: 'Try again' }).click();
  // Previewing records nothing.
  expect(await readStore(page, 'reviewLogs')).toEqual([]);

  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(page.getByTestId('toast')).toContainText(`Added ${subject}`);
  await page.getByRole('link', { name: 'Study deck' }).click();
  await expect(page.getByTestId('card-front')).toHaveText('What is a DBMS?');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good · / }).click();
  await expect.poll(async () => (await readStore(page, 'reviewLogs')).length).toBe(1);

  // Back in the store: "In your decks"; adding again warns first.
  await openInStore(page, subject);
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  const sheet = page.getByRole('dialog', { name: `Add ${subject} again?` });
  await expect(sheet.getByRole('button', { name: 'Keep one copy' })).toBeFocused();
  await sheet.getByRole('button', { name: 'Keep one copy' }).click();
  const decks = (await readStore<{ catalogSlug: string | null }>(page, 'decks')).filter(
    (d) => d.catalogSlug === slug,
  );
  expect(decks).toHaveLength(1);
});

test('publish v2 with the CLI → the update banner → Update → the changed card shows the new text', async ({
  page,
}) => {
  const subject = `Updates ${uniqueSlug('s')}`;
  const slug = uniqueSlug('upd');
  publish(dbmsDeck(slug, subject));
  await openInStore(page, subject);
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await expect(page.getByRole('link', { name: 'Study deck' })).toBeVisible();
  const deckUrl = page.url();
  await expect(page.getByTestId('update-available')).toHaveCount(0);

  const out = publish(
    dbmsDeck(slug, subject, 2, [
      basic('u1-001', 1, 'What is a database management system?'), // changed
      basic('u2-001', 2, 'What is a view?'),
      basic('u2-002', 2, 'What is a join?'), // new
      // u1-002 removed
    ]),
  );
  expect(out).toMatch(/v1 → v2/);
  expect(out).toMatch(/Changed \(1\)/);

  // The app learns about v2 when it next checks (here: opening the store).
  await page.goto('/store');
  await expect(page.getByRole('list', { name: 'Store decks' })).toBeVisible();
  await page.goto('/decks');
  await expect(page.getByTestId('deck-update')).toBeVisible();
  await page.goto(deckUrl);
  const banner = page.getByTestId('update-available');
  await expect(banner).toContainText('Update available — 1 changed, 1 new, 1 removed');
  await banner.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByTestId('toast')).toContainText('Updated: 1 fixed, 1 added, 1 removed.');
  await expect(banner).toHaveCount(0);
  const list = page.getByRole('list', { name: 'Cards' });
  await expect(list).toContainText('What is a database management system?');
  await expect(list).toContainText('What is a join?');
  await expect(list).not.toContainText('Which key identifies a row?');

  const events = (await readStore<{ type: string; props: unknown }>(page, 'events')).filter(
    (e) => e.type === 'deck_update_applied',
  );
  expect(events.map((e) => e.props)).toEqual([{ slug, from: 1, to: 2 }]);
});

test('offline: the Store shows the cached list and blocks Add with the message', async ({
  page,
  context,
}) => {
  const subject = `Offline ${uniqueSlug('s')}`;
  publish(dbmsDeck(uniqueSlug('off'), subject));
  await page.goto('/store');
  await waitForServiceWorker(page);
  await page.goto('/store');
  await expect(page.getByRole('list', { name: 'Store decks' })).toContainText(subject);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/You’re offline\. Showing the store as it was on/)).toBeVisible();
  await page.getByPlaceholder('Search subjects').fill(subject);
  await page
    .getByRole('list', { name: 'Store decks' })
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to my decks' })).toBeDisabled();
  await expect(page.getByText('Connect to the internet to add decks.')).toBeVisible();
  await expect(page.getByText('Connect to the internet to see sample cards.')).toBeVisible();
  await context.setOffline(false);
});

test('unit filter: "Study: Unit 2" studies only unit 2’s cards', async ({ page }) => {
  const subject = `Units ${uniqueSlug('s')}`;
  publish(
    dbmsDeck(uniqueSlug('units'), subject, 1, [
      basic('u1-001', 1, 'Unit one, first'),
      basic('u1-002', 1, 'Unit one, second'),
      basic('u2-001', 2, 'Unit two, first'),
      basic('u2-002', 2, 'Unit two, second'),
    ]),
  );
  await openInStore(page, subject);
  await page.getByRole('button', { name: 'Add to my decks' }).click();
  await expect(page.getByRole('link', { name: 'Study deck' })).toBeVisible();

  await page
    .getByRole('combobox', { name: 'Study' })
    .selectOption({ label: 'Unit 2 · Relational model' });
  await page.getByRole('link', { name: 'Study deck' }).click();
  await expect(page.getByText(`${subject} · Unit 2`)).toBeVisible();
  for (const expected of ['Unit two, first', 'Unit two, second']) {
    await expect(page.getByTestId('card-front')).toHaveText(expected);
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: /^Easy · / }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Review complete' })).toBeVisible();
  const reviewed = await readStore<{ cardId: string }>(page, 'reviewLogs');
  expect(reviewed).toHaveLength(2);
});

test('old ready-made decks are gone from the app; existing copies still work', async ({ page }) => {
  // A device that added "DBMS Basics" before M7 (fixture backup).
  await page.goto('/settings');
  await page.getByLabel('Backup file to import').setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'recall-backup',
        version: 2,
        exportedAt: 1_791_000_000_000,
        decks: [
          {
            id: '01920000-0000-7000-8000-00000000d001',
            name: 'DBMS Basics',
            source: 'prebuilt',
            prebuiltId: 'dbms-basics-v1',
            createdAt: 1_791_000_000_000,
            updatedAt: 1_791_000_000_000,
            deletedAt: null,
          },
        ],
        cards: [
          {
            id: '01920000-0000-7000-8000-00000000c001',
            deckId: '01920000-0000-7000-8000-00000000d001',
            type: 'basic',
            content: { type: 'basic', front: 'What does ACID stand for?', back: 'Atomicity…' },
            front: 'What does ACID stand for?',
            back: 'Atomicity…',
            unit: null,
            sourceKey: null,
            sourceHash: null,
            createdAt: 1_791_000_000_000,
            updatedAt: 1_791_000_000_000,
            deletedAt: null,
          },
        ],
        reviewLogs: [],
      }),
    ),
  });
  await expect(page.getByTestId('toast')).toContainText('Backup imported');

  await page.goto('/decks');
  await expect(page.getByRole('list', { name: 'Decks' })).toContainText('DBMS Basics');
  await expect(page.getByRole('list', { name: 'Decks' })).toContainText('Ready-made');
  await page
    .getByRole('list', { name: 'Decks' })
    .getByRole('link', { name: /DBMS Basics/ })
    .click();
  await page.getByRole('link', { name: 'Study deck' }).click();
  await expect(page.getByTestId('card-front')).toHaveText('What does ACID stand for?');

  // The old Browse page now leads to the Store.
  await page.goto('/browse');
  await expect(page).toHaveURL(/\/store$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Store' })).toBeVisible();
});

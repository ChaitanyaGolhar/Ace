import { catalogCardId, replay, validateDeckFile, type DeckFile } from '@recall/core';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import type { LocalReviewLog } from '../src/db/db';
import { initialize } from '../src/services/bootstrap';
import { loadDeckView, loadHome, searchCards } from '../src/services/overview';
import { loadQueue } from '../src/services/queue';
import { createCatalogDeck } from '../src/services/catalog';
import { searchEverything } from '../src/services/search';
import { buildPushBatch, syncOnce } from '../src/sync/syncOnce';
import { FakeServer, fakeTransport } from './fakeServer';
import { DAY, makeTestContext, T0, type TestContext } from './helpers';

// Big store decks (M7; before that, the bundled Robbins ch. 3 deck had 1,014 cards):
// order, atomicity, timings and sync batching. Timings run on fake-indexeddb in Node, which is several times slower
// than a browser's IndexedDB, so the budgets are generous regression guards; the
// measured numbers are printed for the report.

const BROWSER_TZ = 'Asia/Kolkata';

async function device(options: { realIds?: boolean } = {}): Promise<TestContext> {
  const ctx = makeTestContext(T0);
  if (options.realIds) ctx.newId = () => uuidv7(); // the app's generator (main.tsx)
  await initialize(ctx, { requestPersist: undefined });
  return ctx;
}

/** A catalog deck of `n` cards (keys allow 999 per unit, so big decks span units). */
function syntheticDeck(n: number): DeckFile {
  const units = Math.ceil(n / 999);
  const result = validateDeckFile({
    format: 'ace-deck@2',
    slug: 'big-deck',
    version: 1,
    title: 'Big deck',
    description: 'Synthetic deck for tests.',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE'],
      subject: 'Big',
      subjectCodes: { CSE: null },
      units: Array.from({ length: units }, (_, u) => ({
        number: u + 1,
        title: `Unit ${String(u + 1)}`,
      })),
    },
    price: 0,
    author: 'Tests',
    lastVerifiedAt: '2026-10-11',
    cards: Array.from({ length: n }, (_, i) => ({
      key: `u${String(Math.floor(i / 999) + 1)}-${String((i % 999) + 1).padStart(3, '0')}`,
      unit: Math.floor(i / 999) + 1,
      type: 'basic',
      front: `Question ${String(i + 1).padStart(4, '0')}\n\nA. one\nB. two`,
      back: `Answer ${String(i + 1)}\n\n• first point\n• second point`,
    })),
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.deck;
}

const time = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
};

describe('adding a big store deck', () => {
  it('keeps file order (strictly increasing createdAt), with deterministic ids, and the queue starts at card 1', async () => {
    const ctx = await device({ realIds: true });
    const source = syntheticDeck(1000);
    const deck = await createCatalogDeck(ctx, source);

    const cards = await ctx.db.cards.where('deckId').equals(deck.id).toArray();
    expect(cards).toHaveLength(1000);
    const inFileOrder = [...cards].sort((a, b) => a.front.localeCompare(b.front));
    expect(inFileOrder.map((c) => c.sourceKey)).toEqual(source.cards.map((c) => c.key));
    for (let i = 1; i < inFileOrder.length; i++) {
      const prev = inFileOrder[i - 1];
      const card = inFileOrder[i];
      if (!prev || !card) throw new Error('missing card');
      expect(card.createdAt).toBeGreaterThan(prev.createdAt);
      expect(card.id).toBe(catalogCardId(deck.id, card.sourceKey ?? ''));
    }

    const queue = await loadQueue(ctx, { browserTimeZone: BROWSER_TZ, deckId: deck.id });
    const byId = new Map(cards.map((c) => [c.id, c.front]));
    expect(queue.newCards.slice(0, 3).map((id) => byId.get(id))).toEqual(
      source.cards.slice(0, 3).map((c) => (c.type === 'basic' ? c.front : '')),
    );
  });

  it('writes everything in one Dexie transaction', async () => {
    const ctx = await device();
    const spy = vi.spyOn(ctx.db, 'transaction');
    await createCatalogDeck(ctx, syntheticDeck(1000));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is all-or-nothing: a failure on the last card leaves nothing behind', async () => {
    const ctx = await device();
    ctx.db.cards.hook('creating', (_key, card) => {
      if (card.front.startsWith('Question 1000')) throw new Error('disk full');
    });
    await expect(createCatalogDeck(ctx, syntheticDeck(1000))).rejects.toThrow();
    expect(await ctx.db.decks.count()).toBe(0);
    expect(await ctx.db.cards.count()).toBe(0);
    expect(await ctx.db.cardStates.count()).toBe(0);
    expect(await ctx.db.events.where('type').equals('catalog_deck_added').count()).toBe(0);
  });
});

describe('a 1,000-card deck with 5,000 review logs stays fast', () => {
  it('add, queue, Home, deck page data and search, with timings', async () => {
    const ctx = await device();
    const added = await time(() => createCatalogDeck(ctx, syntheticDeck(1000)));
    const deck = added.value;

    // 5 reviews for every card: most over the last 60 days, a third of them long ago
    // (so they are due today and the queue has real work to do).
    const cards = await ctx.db.cards.where('deckId').equals(deck.id).sortBy('createdAt');
    const logs: LocalReviewLog[] = [];
    cards.forEach((card, i) => {
      for (let r = 0; r < 5; r++) {
        logs.push({
          id: ctx.newId(),
          cardId: card.id,
          rating: r === 2 && i % 7 === 0 ? 1 : 3,
          reviewedAt: T0 - ((i % 3 === 0 ? 400 : 60) - r * 12) * DAY + i * 1000,
          durationMs: 4000,
          deviceId: 'dev',
          voidedAt: null,
          outcome: null,
          dirty: 0,
          localVersion: 1,
        });
      }
    });
    await ctx.db.reviewLogs.bulkAdd(logs);
    await ctx.db.cardStates.bulkPut(
      cards.map((card) =>
        replay(
          card,
          logs.filter((l) => l.cardId === card.id),
        ),
      ),
    );
    expect(await ctx.db.reviewLogs.count()).toBe(5000);

    const opts = { browserTimeZone: BROWSER_TZ };
    const queue = await time(() => loadQueue(ctx, opts));
    const home = await time(() => loadHome(ctx, opts));
    const deckView = await time(() => loadDeckView(ctx, deck.id, opts));
    const search = await time(() => searchEverything(ctx, 'Question 0999'));
    const t0 = performance.now();
    const filtered = searchCards(deckView.value?.cards ?? [], 'answer 42');
    const searchInDeckMs = Math.round(performance.now() - t0);

    // eslint-disable-next-line no-console -- timings for the report
    console.info(
      `[timings] add 1,000 cards: ${String(added.ms)} ms · queue: ${String(queue.ms)} ms · ` +
        `Home: ${String(home.ms)} ms · deck page data: ${String(deckView.ms)} ms · ` +
        `global search: ${String(search.ms)} ms · in-deck search: ${String(searchInDeckMs)} ms`,
    );

    expect(queue.value.due.length).toBeGreaterThan(300);
    expect(deckView.value?.cards).toHaveLength(1000);
    expect(filtered.map((c) => c.back)).toContain('Answer 42\n\n• first point\n• second point');
    expect(search.value.cards.length).toBeGreaterThan(0);
    // Generous budgets on fake-indexeddb; real browsers are faster (see the E2E timings).
    expect(added.ms).toBeLessThan(5000);
    expect(queue.ms).toBeLessThan(1500);
    expect(home.ms).toBeLessThan(1500);
    expect(deckView.ms).toBeLessThan(1500);
    expect(search.ms).toBeLessThan(1500);
    expect(searchInDeckMs).toBeLessThan(100);
  }, 60_000);
});

describe('syncing a freshly added big deck', () => {
  it('pushes a 1,014-card deck (the size of Robbins ch. 3) in batches of at most 500 rows, losing nothing', async () => {
    const ctx = await device();
    const deck = await createCatalogDeck(ctx, syntheticDeck(1014));

    const first = await buildPushBatch(ctx, 'dev');
    const size = (r: typeof first.request) =>
      r.decks.length + r.cards.length + r.reviewLogs.length + r.events.length;
    expect(size(first.request)).toBe(500);

    const server = new FakeServer();
    await syncOnce(ctx, fakeTransport(server));
    expect(server.pushes.length).toBeGreaterThanOrEqual(3); // 1 deck + 1,014 cards + events
    for (const push of server.pushes) expect(size(push)).toBeLessThanOrEqual(500);
    expect(server.decks.has(deck.id)).toBe(true);
    expect(server.cards.size).toBe(1014);
    expect(await ctx.db.cards.where('dirty').equals(1).count()).toBe(0);
  }, 60_000);
});

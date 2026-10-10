import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  catalogCardId,
  contentHash,
  replay,
  summarizeDeck,
  validateDeckFile,
  type CardContent,
  type DeckFile,
} from '@recall/core';
import { RecallDB } from '../src/db/db';
import { getMeta } from '../src/db/meta';
import { initialize } from '../src/services/bootstrap';
import { updateCard } from '../src/services/cards';
import {
  addCatalogDeck,
  availableUpdate,
  CatalogOfflineError,
  checkForUpdates,
  createCatalogDeck,
  loadStore,
  ownedCatalogSlugs,
  planCatalogUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  updateCatalogDeck,
  type CatalogApi,
} from '../src/services/catalog';
import { loadQueue } from '../src/services/queue';
import { rateCard } from '../src/services/review';
import { DAY, HOUR, makeTestContext, MINUTE, T0, type TestContext } from './helpers';

// M7 deck store in the app (BUILD_BRIEF_M6_M8 §7.5, §7.6): adding a catalog deck,
// update checks, and applying an update. Every write is one Dexie transaction.

const basic = (front: string): CardContent => ({ type: 'basic', front, back: `${front} — answer` });

function file(
  version: number,
  cards: [string, CardContent, number?][],
  slug = 'sppu-te-cse-dbms',
): DeckFile {
  const result = validateDeckFile({
    format: 'ace-deck@2',
    slug,
    version,
    title: 'Database Management Systems',
    description: 'Unit-wise revision.',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE'],
      subject: 'DBMS',
      subjectCodes: { CSE: 'PCC301COM' },
      units: [
        { number: 1, title: 'One' },
        { number: 2, title: 'Two' },
      ],
    },
    price: 0,
    author: 'A',
    lastVerifiedAt: '2026-10-11',
    cards: cards.map(([key, content, unit]) => ({ key, unit: unit ?? 1, ...content })),
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.deck;
}

const V1 = file(1, [
  ['u1-001', basic('What is a DBMS?')],
  ['u1-002', basic('What is a key?')],
  ['u2-001', basic('What is a view?'), 2],
]);
const V2 = file(2, [
  ['u1-001', basic('What is a DBMS?')],
  ['u1-002', basic('What is a primary key?')], // changed
  ['u2-002', basic('What is a join?'), 2], // new
  // u2-001 removed
]);

class FakeCatalogApi implements CatalogApi {
  online = true;
  calls: string[] = [];
  constructor(public files: DeckFile[]) {}
  private check() {
    if (!this.online) return Promise.reject(new CatalogOfflineError());
    return Promise.resolve();
  }
  async list() {
    this.calls.push('list');
    await this.check();
    const latest = new Map<string, DeckFile>();
    for (const f of this.files) {
      if ((latest.get(f.slug)?.version ?? 0) < f.version) latest.set(f.slug, f);
    }
    return { decks: [...latest.values()].map(summarizeDeck) };
  }
  async detail(slug: string) {
    this.calls.push(`detail ${slug}`);
    await this.check();
    const deck = (await this.list()).decks.find((d) => d.slug === slug);
    if (!deck) throw new Error('not found');
    return { deck, samples: [] };
  }
  async version(slug: string, version: number) {
    this.calls.push(`version ${slug} ${String(version)}`);
    await this.check();
    const f = this.files.find((x) => x.slug === slug && x.version === version);
    if (!f) throw new Error('not found');
    return structuredClone(f);
  }
}

async function setup(files: DeckFile[] = [V1]) {
  const ctx = makeTestContext();
  await initialize(ctx, { requestPersist: undefined });
  return { ctx, api: new FakeCatalogApi(files) };
}

const liveCards = async (ctx: TestContext, deckId: string) =>
  (await ctx.db.cards.where('deckId').equals(deckId).toArray()).filter((c) => c.deletedAt === null);

describe('adding a catalog deck (§7.5)', () => {
  it('creates the deck and its cards in one go: deterministic ids, key, hash, unit, file order', async () => {
    const { ctx, api } = await setup();
    const deck = await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    expect(deck).toMatchObject({
      name: 'Database Management Systems',
      source: 'catalog',
      prebuiltId: null,
      catalogSlug: 'sppu-te-cse-dbms',
      catalogVersion: 1,
      dirty: 1,
    });
    const cards = (await ctx.db.cards.where('deckId').equals(deck.id).toArray()).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    expect(cards.map((c) => c.sourceKey)).toEqual(['u1-001', 'u1-002', 'u2-001']);
    for (const c of cards) {
      expect(c.id).toBe(catalogCardId(deck.id, c.sourceKey ?? ''));
      expect(c.sourceHash).toBe(contentHash(c.content));
      expect(c.dirty).toBe(1);
    }
    expect(cards.map((c) => c.unit)).toEqual([1, 1, 2]);
    // New cards are introduced in file order: createdAt strictly increasing.
    expect(cards.map((c) => c.createdAt)).toEqual([T0, T0 + 1, T0 + 2]);
    expect(await ctx.db.cardStates.count()).toBe(3);
    const queue = await loadQueue(ctx, { browserTimeZone: 'UTC', deckId: deck.id });
    expect(queue.newCards).toEqual(cards.map((c) => c.id));
  });

  it('records catalog_deck_added with the slug and version only', async () => {
    const { ctx, api } = await setup();
    await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    const events = await ctx.db.events.where('type').equals('catalog_deck_added').toArray();
    expect(events.map((e) => e.props)).toEqual([{ slug: 'sppu-te-cse-dbms', version: 1 }]);
  });

  it('is all or nothing: if a write fails, no deck and no cards are stored', async () => {
    const { ctx } = await setup();
    ctx.db.cardStates.hook('creating', () => {
      throw new Error('simulated crash');
    });
    await expect(createCatalogDeck(ctx, V1)).rejects.toThrow('simulated crash');
    expect(await ctx.db.decks.count()).toBe(0);
    expect(await ctx.db.cards.count()).toBe(0);
  });

  it('needs the network: offline, adding fails with CatalogOfflineError and stores nothing', async () => {
    const { ctx, api } = await setup();
    api.online = false;
    await expect(addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1)).rejects.toBeInstanceOf(
      CatalogOfflineError,
    );
    expect(await ctx.db.decks.count()).toBe(0);
  });

  it('knows which catalog decks are already in the user’s decks (for “In your decks” and the duplicate sheet)', async () => {
    const { ctx, api } = await setup();
    expect(await ownedCatalogSlugs(ctx)).toEqual(new Set());
    const deck = await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    expect(await ownedCatalogSlugs(ctx)).toEqual(new Set(['sppu-te-cse-dbms']));
    await ctx.db.decks.update(deck.id, { deletedAt: T0 });
    expect(await ownedCatalogSlugs(ctx)).toEqual(new Set());
  });

  it('a second copy gets its own ids (they derive from the new deck id)', async () => {
    const { ctx, api } = await setup();
    const a = await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    const b = await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    expect(a.id).not.toBe(b.id);
    expect(await ctx.db.cards.count()).toBe(6);
  });
});

describe('the store list, cached for offline (§7.5)', () => {
  it('online: fetches, caches and remembers the latest versions', async () => {
    const { ctx, api } = await setup([V1, V2]);
    const store = await loadStore(ctx, api);
    expect(store).toMatchObject({ offline: false, fetchedAt: T0 });
    expect(store?.decks.map((d) => [d.slug, d.version])).toEqual([['sppu-te-cse-dbms', 2]]);
    expect(await getMeta(ctx.db, 'catalogLatest')).toEqual({ 'sppu-te-cse-dbms': 2 });
  });

  it('offline: the cached list, marked offline; nothing cached yet: null', async () => {
    const { ctx, api } = await setup([V1]);
    api.online = false;
    expect(await loadStore(ctx, api)).toBeNull();
    api.online = true;
    await loadStore(ctx, api);
    api.online = false;
    ctx.advance(HOUR);
    expect(await loadStore(ctx, api)).toMatchObject({ offline: true, fetchedAt: T0 });
  });
});

describe('update checks (§7.6): at start and at most every 12 hours', () => {
  it('checks when due, then not again for 12 hours (unless forced)', async () => {
    const { ctx, api } = await setup([V1, V2]);
    expect(await checkForUpdates(ctx, api)).toBe(true);
    ctx.advance(UPDATE_CHECK_INTERVAL_MS - MINUTE);
    expect(await checkForUpdates(ctx, api)).toBe(false);
    expect(await checkForUpdates(ctx, api, { force: true })).toBe(true);
    ctx.advance(UPDATE_CHECK_INTERVAL_MS);
    expect(await checkForUpdates(ctx, api)).toBe(true);
    expect(api.calls.filter((c) => c === 'list')).toHaveLength(3);
  });

  it('offline: no check, no error, and it tries again next time', async () => {
    const { ctx, api } = await setup([V1]);
    api.online = false;
    expect(await checkForUpdates(ctx, api)).toBe(false);
    api.online = true;
    expect(await checkForUpdates(ctx, api)).toBe(true);
  });

  it('a deck on an older version has an update available; the banner counts come from the plan', async () => {
    const { ctx, api } = await setup([V1]);
    const deck = await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    expect(await availableUpdate(ctx, deck.id)).toBeNull();
    api.files.push(V2);
    await checkForUpdates(ctx, api, { force: true });
    expect(await availableUpdate(ctx, deck.id)).toEqual({
      slug: 'sppu-te-cse-dbms',
      from: 1,
      to: 2,
    });
    const planned = await planCatalogUpdate(ctx, api, deck.id);
    expect(planned?.plan.summary).toEqual({ changed: 1, added: 1, removed: 1 });
  });
});

describe('applying an update (§7.6)', () => {
  async function withUpdate() {
    const { ctx, api } = await setup([V1, V2]);
    const deck = await addCatalogDeck(ctx, api, 'sppu-te-cse-dbms', 1);
    await checkForUpdates(ctx, api, { force: true });
    return { ctx, api, deck };
  }
  const byKey = async (ctx: TestContext, deckId: string, key: string) =>
    (await ctx.db.cards.where('deckId').equals(deckId).toArray()).find((c) => c.sourceKey === key);

  it('changed + unedited: new text; new: added; removed + unedited: tombstoned; version set', async () => {
    const { ctx, api, deck } = await withUpdate();
    ctx.advance(DAY);
    const applied = await updateCatalogDeck(ctx, api, deck.id);
    expect(applied).toEqual({ fixed: 1, added: 1, removed: 1, keptEdits: 0 });

    const changed = await byKey(ctx, deck.id, 'u1-002');
    expect(changed).toMatchObject({
      front: 'What is a primary key?',
      sourceHash: contentHash(basic('What is a primary key?')),
      dirty: 1,
      updatedAt: T0 + DAY,
    });
    expect(changed?.id).toBe(catalogCardId(deck.id, 'u1-002'));

    const added = await byKey(ctx, deck.id, 'u2-002');
    expect(added).toMatchObject({ id: catalogCardId(deck.id, 'u2-002'), unit: 2, deletedAt: null });
    // Introduced after the existing new cards.
    expect(added?.createdAt).toBeGreaterThan(T0 + 2);

    expect((await byKey(ctx, deck.id, 'u2-001'))?.deletedAt).toBe(T0 + DAY);
    expect(await ctx.db.decks.get(deck.id)).toMatchObject({ catalogVersion: 2, dirty: 1 });
    expect(await availableUpdate(ctx, deck.id)).toBeNull();
  });

  it('changed but edited by the user: their version is kept ("kept your edits")', async () => {
    const { ctx, api, deck } = await withUpdate();
    const mine = await byKey(ctx, deck.id, 'u1-002');
    await updateCard(ctx, mine?.id ?? '', { front: 'My own wording', back: 'Mine' });
    const applied = await updateCatalogDeck(ctx, api, deck.id);
    expect(applied).toMatchObject({ fixed: 0, keptEdits: 1 });
    expect((await byKey(ctx, deck.id, 'u1-002'))?.front).toBe('My own wording');
  });

  it('removed but edited: kept', async () => {
    const { ctx, api, deck } = await withUpdate();
    const mine = await byKey(ctx, deck.id, 'u2-001');
    await updateCard(ctx, mine?.id ?? '', { front: 'What is a view? (my note)', back: 'Mine' });
    const applied = await updateCatalogDeck(ctx, api, deck.id);
    expect(applied).toMatchObject({ removed: 0, keptEdits: 1 });
    expect((await byKey(ctx, deck.id, 'u2-001'))?.deletedAt).toBeNull();
  });

  it('schedule preserved: a reviewed card that is updated keeps its CardState and history', async () => {
    const { ctx, api, deck } = await withUpdate();
    const card = await byKey(ctx, deck.id, 'u1-002');
    if (!card) throw new Error('missing');
    ctx.advance(MINUTE);
    await rateCard(ctx, { cardId: card.id, rating: 3, durationMs: 1000 });
    ctx.advance(10 * MINUTE);
    await rateCard(ctx, { cardId: card.id, rating: 4, durationMs: 1000 });
    const before = await ctx.db.cardStates.get(card.id);
    const logs = await ctx.db.reviewLogs.where('cardId').equals(card.id).toArray();
    ctx.advance(HOUR);
    await updateCatalogDeck(ctx, api, deck.id);
    expect((await byKey(ctx, deck.id, 'u1-002'))?.front).toBe('What is a primary key?');
    expect(await ctx.db.cardStates.get(card.id)).toEqual(before);
    expect(await ctx.db.reviewLogs.where('cardId').equals(card.id).toArray()).toEqual(logs);
    const updated = await ctx.db.cards.get(card.id);
    if (!updated) throw new Error('missing');
    expect(replay(updated, logs)).toEqual(before);
  });

  it('a removed card keeps its review logs (only the card is tombstoned)', async () => {
    const { ctx, api, deck } = await withUpdate();
    const card = await byKey(ctx, deck.id, 'u2-001');
    await rateCard(ctx, { cardId: card?.id ?? '', rating: 3, durationMs: 1000 });
    await updateCatalogDeck(ctx, api, deck.id);
    expect(
      await ctx.db.reviewLogs
        .where('cardId')
        .equals(card?.id ?? '')
        .count(),
    ).toBe(1);
  });

  it('records deck_update_applied {slug, from, to}', async () => {
    const { ctx, api, deck } = await withUpdate();
    await updateCatalogDeck(ctx, api, deck.id);
    const events = await ctx.db.events.where('type').equals('deck_update_applied').toArray();
    expect(events.map((e) => e.props)).toEqual([{ slug: 'sppu-te-cse-dbms', from: 1, to: 2 }]);
  });

  it('skipping versions: a copy on v1 goes straight to v3', async () => {
    const V3 = file(3, [
      ['u1-001', basic('What is a DBMS?')],
      ['u1-002', basic('What is a candidate key?')],
      ['u2-002', basic('What is a join?'), 2],
      ['u2-003', basic('What is an index?'), 2],
    ]);
    const { ctx, api, deck } = await withUpdate();
    api.files.push(V3);
    await checkForUpdates(ctx, api, { force: true });
    expect(await availableUpdate(ctx, deck.id)).toMatchObject({ from: 1, to: 3 });
    const applied = await updateCatalogDeck(ctx, api, deck.id);
    expect(applied).toEqual({ fixed: 1, added: 2, removed: 1, keptEdits: 0 });
    expect(api.calls).toContain('version sppu-te-cse-dbms 3');
    expect(api.calls).not.toContain('version sppu-te-cse-dbms 2');
    expect((await liveCards(ctx, deck.id)).map((c) => c.sourceKey).sort()).toEqual([
      'u1-001',
      'u1-002',
      'u2-002',
      'u2-003',
    ]);
  });

  it('applying twice changes nothing the second time', async () => {
    const { ctx, api, deck } = await withUpdate();
    await updateCatalogDeck(ctx, api, deck.id);
    const before = await ctx.db.cards.toArray();
    await expect(updateCatalogDeck(ctx, api, deck.id)).resolves.toEqual({
      fixed: 0,
      added: 0,
      removed: 0,
      keptEdits: 0,
    });
    expect(await ctx.db.cards.toArray()).toEqual(before);
  });
});

describe('local database upgrade to version 4 (M7)', () => {
  it('existing decks get no catalog fields; old ready-made copies, cards, logs and states untouched; one re-pull', async () => {
    const name = 'upgrade-v3-to-v4';
    const v3 = new Dexie(name);
    v3.version(1).stores({
      decks: 'id, updatedAt, deletedAt, dirty',
      cards: 'id, deckId, updatedAt, deletedAt, dirty',
      reviewLogs: 'id, cardId, reviewedAt, dirty',
      cardStates: 'cardId, due, state',
      meta: 'key',
    });
    v3.version(2).stores({ events: 'id, type, occurredAt, dirty' });
    v3.version(3).stores({});
    const prebuiltDeck = {
      id: '01920000-0000-7000-8000-000000000001',
      name: 'Robbins Ch. 3',
      source: 'prebuilt',
      prebuiltId: 'robbins-ch3-inflammation-repair-v1',
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
      dirty: 0,
      localVersion: 1,
    };
    const card = {
      id: '01920000-0000-7000-8000-000000000101',
      deckId: prebuiltDeck.id,
      type: 'basic',
      content: { type: 'basic', front: 'Q', back: 'A' },
      front: 'Q',
      back: 'A',
      unit: null,
      sourceKey: null,
      sourceHash: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
      dirty: 0,
      localVersion: 1,
    };
    const state = { cardId: card.id, due: T0 + 3 * DAY, state: 'review', stability: 3 };
    await v3.table('decks').put(prebuiltDeck);
    await v3.table('cards').put(card);
    await v3.table('cardStates').put(state);
    await v3.table('meta').put({ key: 'syncCursor', value: '4321' });
    v3.close();

    const db = new RecallDB(name);
    await db.open();
    expect(db.verno).toBe(4);
    expect(await db.decks.get(prebuiltDeck.id)).toEqual({
      ...prebuiltDeck,
      catalogSlug: null,
      catalogVersion: null,
    });
    expect(await db.cards.get(card.id)).toEqual(card);
    expect(await db.cardStates.get(card.id)).toEqual(state);
    expect(await getMeta(db, 'syncCursor')).toBe('0');
    db.close();
  });
});

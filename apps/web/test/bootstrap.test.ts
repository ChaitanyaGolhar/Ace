import { describe, expect, it, vi } from 'vitest';
import { cardFields, replay, SCHEDULER_VERSION, type CardState } from '@recall/core';
import { initialize } from '../src/services/bootstrap';
import { getMeta, setMeta } from '../src/db/meta';
import { makeTestContext, T0, DAY } from './helpers';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('initialize', () => {
  it('generates a UUID v7 deviceId on first launch and keeps it afterwards', async () => {
    const ctx = makeTestContext();
    await initialize(ctx, { requestPersist: () => Promise.resolve(true) });
    const first = await getMeta(ctx.db, 'deviceId');
    expect(first).toMatch(UUID_V7);
    await initialize(ctx, { requestPersist: () => Promise.resolve(true) });
    expect(await getMeta(ctx.db, 'deviceId')).toBe(first);
  });

  it('asks for persistent storage on first launch only, and stores the answer', async () => {
    const ctx = makeTestContext();
    const requestPersist = vi.fn(() => Promise.resolve(false));
    await initialize(ctx, { requestPersist });
    await initialize(ctx, { requestPersist });
    expect(requestPersist).toHaveBeenCalledTimes(1);
    expect(await getMeta(ctx.db, 'storagePersistence')).toBe('denied');
  });

  it('records "unsupported" when the browser has no storage.persist()', async () => {
    const ctx = makeTestContext();
    await initialize(ctx, { requestPersist: undefined });
    expect(await getMeta(ctx.db, 'storagePersistence')).toBe('unsupported');
  });

  it('still starts if the persistence request fails', async () => {
    const ctx = makeTestContext();
    await initialize(ctx, { requestPersist: () => Promise.reject(new Error('nope')) });
    expect(await getMeta(ctx.db, 'storagePersistence')).toBe('denied');
  });

  describe('scheduler version', () => {
    async function seedCardWithReview() {
      const ctx = makeTestContext();
      const deck = {
        id: ctx.newId(),
        name: 'D',
        source: 'user' as const,
        prebuiltId: null,
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
        dirty: 1 as const,
        localVersion: 1,
      };
      const card = {
        id: ctx.newId(),
        deckId: deck.id,
        ...cardFields({ type: 'basic', front: 'f', back: 'b' }),
        unit: null,
        sourceKey: null,
        sourceHash: null,
        createdAt: T0,
        updatedAt: T0,
        deletedAt: null,
        dirty: 1 as const,
        localVersion: 1,
      };
      const log = {
        id: ctx.newId(),
        cardId: card.id,
        rating: 3 as const,
        reviewedAt: T0 + DAY,
        durationMs: 1000,
        deviceId: 'd',
        voidedAt: null,
        outcome: null,
        dirty: 1 as const,
        localVersion: 1,
      };
      await ctx.db.decks.add(deck);
      await ctx.db.cards.add(card);
      await ctx.db.reviewLogs.add(log);
      const stale: CardState = { ...replay(card, []), due: 1 };
      await ctx.db.cardStates.put(stale);
      return { ctx, card, log, stale };
    }

    it('rebuilds every CardState by replay when the stored version differs', async () => {
      const { ctx, card, log } = await seedCardWithReview();
      await setMeta(ctx.db, 'schedulerVersion', SCHEDULER_VERSION - 1);
      await initialize(ctx, { requestPersist: undefined });
      expect(await ctx.db.cardStates.get(card.id)).toEqual(replay(card, [log]));
      expect(await getMeta(ctx.db, 'schedulerVersion')).toBe(SCHEDULER_VERSION);
    });

    it('rebuilds on a first launch with no stored version', async () => {
      const { ctx, card, log } = await seedCardWithReview();
      await initialize(ctx, { requestPersist: undefined });
      expect(await ctx.db.cardStates.get(card.id)).toEqual(replay(card, [log]));
    });

    it('leaves CardStates alone when the version matches', async () => {
      const { ctx, card, stale } = await seedCardWithReview();
      await setMeta(ctx.db, 'schedulerVersion', SCHEDULER_VERSION);
      await initialize(ctx, { requestPersist: undefined });
      expect(await ctx.db.cardStates.get(card.id)).toEqual(stale);
    });
  });
});

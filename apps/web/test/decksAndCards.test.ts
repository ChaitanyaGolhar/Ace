import { describe, expect, it } from 'vitest';
import { initialState } from '@recall/core';
import { createDeck, deleteDeck, renameDeck } from '../src/services/decks';
import { createCard, deleteCard, updateCard } from '../src/services/cards';
import { makeTestContext, MINUTE, T0 } from './helpers';

describe('createDeck', () => {
  it('creates a dirty user deck with trimmed name', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, '  Biology  ');
    expect(await ctx.db.decks.get(deck.id)).toEqual({
      id: deck.id,
      name: 'Biology',
      source: 'user',
      prebuiltId: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
      dirty: 1,
      localVersion: 1,
    });
  });

  it('rejects an empty or whitespace-only name', async () => {
    const ctx = makeTestContext();
    await expect(createDeck(ctx, '   ')).rejects.toThrow();
    expect(await ctx.db.decks.count()).toBe(0);
  });
});

describe('renameDeck', () => {
  it('sets the name, updatedAt=now, dirty=1 and increments localVersion', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'Old');
    await ctx.db.decks.update(deck.id, { dirty: 0 });
    ctx.advance(MINUTE);
    await renameDeck(ctx, deck.id, ' New ');
    expect(await ctx.db.decks.get(deck.id)).toMatchObject({
      name: 'New',
      updatedAt: T0 + MINUTE,
      dirty: 1,
      localVersion: 2,
    });
  });

  it('refuses to edit a deleted deck (tombstones are sticky)', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    await deleteDeck(ctx, deck.id);
    await expect(renameDeck(ctx, deck.id, 'X')).rejects.toThrow();
  });
});

describe('deleteDeck', () => {
  it('tombstones the deck and all its live cards, leaving other decks alone', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const other = await createDeck(ctx, 'Other');
    const c1 = await createCard(ctx, deck.id, 'a', 'b');
    const c2 = await createCard(ctx, deck.id, 'c', 'd');
    const keep = await createCard(ctx, other.id, 'e', 'f');
    ctx.advance(MINUTE);
    await deleteCard(ctx, c2.id);
    ctx.advance(MINUTE);
    await deleteDeck(ctx, deck.id);

    const at = T0 + 2 * MINUTE;
    expect(await ctx.db.decks.get(deck.id)).toMatchObject({
      deletedAt: at,
      updatedAt: at,
      dirty: 1,
      localVersion: 2,
    });
    expect(await ctx.db.cards.get(c1.id)).toMatchObject({ deletedAt: at, updatedAt: at, dirty: 1 });
    // Already-deleted card keeps its original tombstone.
    expect((await ctx.db.cards.get(c2.id))?.deletedAt).toBe(T0 + MINUTE);
    expect((await ctx.db.cards.get(keep.id))?.deletedAt).toBeNull();
    expect((await ctx.db.decks.get(other.id))?.deletedAt).toBeNull();
  });

  it('is a single transaction: if tombstoning a card fails, the deck is not deleted', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    await createCard(ctx, deck.id, 'a', 'b');
    ctx.db.cards.hook('updating', () => {
      throw new Error('simulated crash');
    });
    await expect(deleteDeck(ctx, deck.id)).rejects.toThrow('simulated crash');
    expect((await ctx.db.decks.get(deck.id))?.deletedAt).toBeNull();
  });

  it('deleting twice keeps the first deletedAt', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    await deleteDeck(ctx, deck.id);
    ctx.advance(MINUTE);
    await deleteDeck(ctx, deck.id);
    expect((await ctx.db.decks.get(deck.id))?.deletedAt).toBe(T0);
  });
});

describe('createCard', () => {
  it('stores a dirty card with trimmed text (inner line breaks kept) and its initial state', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, '\n line 1\nline 2 \n', ' back ');
    expect(await ctx.db.cards.get(card.id)).toEqual({
      id: card.id,
      deckId: deck.id,
      front: 'line 1\nline 2',
      back: 'back',
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
      dirty: 1,
      localVersion: 1,
    });
    expect(await ctx.db.cardStates.get(card.id)).toEqual(initialState(card));
  });

  it('rejects empty sides and unknown or deleted decks', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    await expect(createCard(ctx, deck.id, ' ', 'b')).rejects.toThrow();
    await expect(createCard(ctx, deck.id, 'f', '')).rejects.toThrow();
    await expect(createCard(ctx, ctx.newId(), 'f', 'b')).rejects.toThrow();
    await deleteDeck(ctx, deck.id);
    await expect(createCard(ctx, deck.id, 'f', 'b')).rejects.toThrow();
    expect(await ctx.db.cards.count()).toBe(0);
  });
});

describe('updateCard', () => {
  it('sets text, updatedAt=now, dirty=1 and increments localVersion', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    await ctx.db.cards.update(card.id, { dirty: 0 });
    ctx.advance(MINUTE);
    await updateCard(ctx, card.id, { front: 'F2', back: 'B2' });
    expect(await ctx.db.cards.get(card.id)).toMatchObject({
      front: 'F2',
      back: 'B2',
      updatedAt: T0 + MINUTE,
      dirty: 1,
      localVersion: 2,
    });
  });

  it('does nothing when the text is unchanged', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    await ctx.db.cards.update(card.id, { dirty: 0 });
    ctx.advance(MINUTE);
    await updateCard(ctx, card.id, { front: ' f ', back: 'b' });
    expect(await ctx.db.cards.get(card.id)).toMatchObject({
      updatedAt: T0,
      dirty: 0,
      localVersion: 1,
    });
  });

  it('refuses to edit a deleted card (tombstones are sticky)', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    await deleteCard(ctx, card.id);
    await expect(updateCard(ctx, card.id, { front: 'x', back: 'y' })).rejects.toThrow();
  });
});

describe('deleteCard', () => {
  it('sets deletedAt=updatedAt=now, dirty=1, increments localVersion, and is idempotent', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const card = await createCard(ctx, deck.id, 'f', 'b');
    ctx.advance(MINUTE);
    await deleteCard(ctx, card.id);
    ctx.advance(MINUTE);
    await deleteCard(ctx, card.id);
    expect(await ctx.db.cards.get(card.id)).toMatchObject({
      deletedAt: T0 + MINUTE,
      updatedAt: T0 + MINUTE,
      dirty: 1,
      localVersion: 2,
    });
  });
});

describe('max lengths (client side, same limits as the server)', () => {
  it('rejects a deck name over 200 characters with a readable error', async () => {
    const ctx = makeTestContext();
    await expect(createDeck(ctx, 'x'.repeat(201))).rejects.toThrow(
      'Deck name can be at most 200 characters.',
    );
    await expect(createDeck(ctx, 'x'.repeat(200))).resolves.toBeDefined();
  });

  it('rejects card text over 20,000 characters on either side', async () => {
    const ctx = makeTestContext();
    const deck = await createDeck(ctx, 'D');
    const long = 'y'.repeat(20_001);
    await expect(createCard(ctx, deck.id, long, 'b')).rejects.toThrow(
      'Front can be at most 20,000 characters.',
    );
    await expect(createCard(ctx, deck.id, 'f', long)).rejects.toThrow(
      'Back can be at most 20,000 characters.',
    );
    const card = await createCard(ctx, deck.id, 'y'.repeat(20_000), 'b');
    await expect(updateCard(ctx, card.id, { front: 'f', back: long })).rejects.toThrow(
      'Back can be at most 20,000 characters.',
    );
  });
});

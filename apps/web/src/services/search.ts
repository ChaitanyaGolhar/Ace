import type { AppContext } from './context';

export interface SearchResults {
  decks: { id: string; name: string }[];
  cards: { id: string; deckId: string; deckName: string; front: string }[];
}

const MAX_CARD_RESULTS = 50;

/** Global search: live decks by name, live cards (in live decks) by question or answer. */
export async function searchEverything(ctx: AppContext, query: string): Promise<SearchResults> {
  const q = query.trim().toLowerCase();
  if (q === '') return { decks: [], cards: [] };
  const { db } = ctx;
  return db.transaction('r', [db.decks, db.cards], async () => {
    const decks = (await db.decks.toArray())
      .filter((d) => d.deletedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const deckNames = new Map(decks.map((d) => [d.id, d.name]));
    const cards = (await db.cards.toArray())
      .filter(
        (c) =>
          c.deletedAt === null &&
          deckNames.has(c.deckId) &&
          (c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_CARD_RESULTS);
    return {
      decks: decks
        .filter((d) => d.name.toLowerCase().includes(q))
        .map((d) => ({ id: d.id, name: d.name })),
      cards: cards.map((c) => ({
        id: c.id,
        deckId: c.deckId,
        deckName: deckNames.get(c.deckId) ?? '',
        front: c.front,
      })),
    };
  });
}

import {
  cardFields,
  applyReview,
  initialState,
  type Card,
  type Deck,
  type ReviewLog,
} from '@recall/core';
import type { SeedBackup } from './seedBackup';

// A big deck for performance tests: `cardCount` cards, each with `logsPerCard` reviews
// generated with the real scheduler (so every history is consistent), ending around
// `now`. Test data only.

const DAY = 86_400_000;

let n = 0;
function uuid7(at: number): string {
  n += 1;
  const ms = at.toString(16).padStart(12, '0');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const bigQuestion = (i: number) => `Big question ${String(i + 1).padStart(4, '0')}`;

export function buildBigDeckBackup(now: number, cardCount = 1000, logsPerCard = 5): SeedBackup {
  // Every card gets `logsPerCard` reviews unless it would be reviewed in the future.
  const start = now - 200 * DAY;
  const deck: Deck = {
    id: uuid7(start),
    name: 'Big deck',
    source: 'user',
    prebuiltId: null,
    catalogSlug: null,
    catalogVersion: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
  const cards: Card[] = [];
  const reviewLogs: ReviewLog[] = [];
  for (let i = 0; i < cardCount; i++) {
    const card: Card = {
      id: uuid7(start + i),
      deckId: deck.id,
      ...cardFields({
        type: 'basic',
        front: `${bigQuestion(i)}\n\nA. one\nB. two`,
        back: `Answer ${String(i + 1)}\n\n• first point\n• second point`,
      }),
      unit: null,
      sourceKey: null,
      sourceHash: null,
      createdAt: start + i,
      updatedAt: start + i,
      deletedAt: null,
    };
    cards.push(card);
    let state = initialState(card);
    // First seen 60–180 days ago, then reviewed whenever due: like a real collection,
    // most histories end weeks ago and some cards are due today.
    let at = now - (60 + (i % 120)) * DAY;
    for (let r = 0; r < logsPerCard; r++) {
      const rating = r === 2 && i % 7 === 0 ? 1 : 3;
      const log: ReviewLog = {
        id: uuid7(at),
        cardId: card.id,
        rating,
        reviewedAt: at,
        durationMs: 5000,
        deviceId: 'seed',
        voidedAt: null,
        outcome: null,
      };
      reviewLogs.push(log);
      state = applyReview(state, log);
      at = Math.max(state.due, at + 60_000);
      if (at >= now) break;
    }
  }
  return { format: 'recall-backup', version: 2, exportedAt: now, decks: [deck], cards, reviewLogs };
}

import {
  applyReview,
  cardFields,
  initialState,
  type Card,
  type CardContent,
  type Deck,
  type ReviewLog,
} from '@recall/core';
import type { SeedBackup } from './seedBackup';

// A student coming back after a break (feel pass, moment 3): one deck whose cards were
// all studied once, weeks ago, and are now overdue, plus a small deck of new multiple
// choice and fill-in-the-blank cards for the answer-feedback moments. Test data only.

const DAY = 86_400_000;
const HOUR = 3_600_000;

let idCounter = 0;
function uuid7(at: number): string {
  idCounter += 1;
  const ms = at.toString(16).padStart(12, '0');
  const tail = (0x100000 + idCounter).toString(16).padStart(12, '0');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7000-8000-${tail}`;
}

export const BREAK_DECK = 'Computer Networks';
export const FEEL_DECK = 'Feel check';

/** "CN 7: …" — the n-th card (1-based) of the overdue deck. Its due order is its number. */
export const breakFront = (n: number) => `CN ${String(n)}: what does layer ${String(n)} do?`;

export const FEEL_CARDS: CardContent[] = [
  {
    type: 'mcq',
    question: 'Which layer of the OSI model routes packets between networks?',
    options: [
      { id: 'a', text: 'Data link' },
      { id: 'b', text: 'Network' },
      { id: 'c', text: 'Transport' },
      { id: 'd', text: 'Session' },
    ],
    correct: 'b',
    explanation:
      'The network layer (IP) chooses the path between networks; data link works within one.',
  },
  {
    type: 'mcq',
    question: 'Which protocol gives reliable, ordered delivery?',
    options: [
      { id: 'a', text: 'UDP' },
      { id: 'b', text: 'TCP' },
      { id: 'c', text: 'ICMP' },
    ],
    correct: 'b',
    explanation:
      'TCP numbers and acknowledges segments and retransmits lost ones; UDP does neither.',
  },
  {
    type: 'cloze',
    text: 'A {{subnet mask}} tells which part of an IP address is the network part.',
    accepted: [],
    hint: null,
    extra: 'With /24, the first 24 bits are the network.',
  },
  {
    type: 'cloze',
    text: 'DNS translates a {{domain name}} into an IP address.',
    accepted: [],
    hint: null,
    extra: 'Resolvers cache answers for the record’s TTL.',
  },
];

function deck(name: string, at: number): Deck {
  return {
    id: uuid7(at),
    name,
    source: 'user',
    prebuiltId: null,
    catalogSlug: null,
    catalogVersion: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

function card(deckId: string, content: CardContent, at: number): Card {
  return {
    id: uuid7(at),
    deckId,
    ...cardFields(content),
    unit: null,
    sourceKey: null,
    sourceHash: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

/**
 * @param now  the browser's "now"
 * @param due  how many overdue cards (each studied once, rated Easy, ~60 days ago; card n
 *             was studied an hour after card n−1, so it falls due after it)
 */
export function buildBreakBackup(now: number, due = 45): SeedBackup {
  const start = now - 60 * DAY;
  const decks: Deck[] = [];
  const cards: Card[] = [];
  const reviewLogs: ReviewLog[] = [];

  const cn = deck(BREAK_DECK, start);
  decks.push(cn);
  for (let i = 1; i <= due; i++) {
    const c = card(
      cn.id,
      { type: 'basic', front: breakFront(i), back: `Layer ${String(i)} answer.` },
      start + i,
    );
    cards.push(c);
    const log: ReviewLog = {
      id: uuid7(start + i * HOUR),
      cardId: c.id,
      rating: 4,
      reviewedAt: start + i * HOUR,
      durationMs: 6000,
      deviceId: 'seed',
      voidedAt: null,
      outcome: null,
    };
    reviewLogs.push(log);
    if (applyReview(initialState(c), log).due > now - 2 * DAY) {
      throw new Error('breakBackup: a card is not overdue');
    }
  }

  const feel = deck(FEEL_DECK, start);
  decks.push(feel);
  FEEL_CARDS.forEach((content, i) => cards.push(card(feel.id, content, start + i)));

  return { format: 'recall-backup', version: 2, exportedAt: now, decks, cards, reviewLogs };
}

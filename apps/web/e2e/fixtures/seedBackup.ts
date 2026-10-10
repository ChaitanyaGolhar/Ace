import {
  cardFields,
  applyReview,
  initialState,
  type Card,
  type CardContent,
  type Deck,
  type ReviewLog,
} from '@recall/core';

// Builds a realistic backup for screenshots and UI tests: a few decks whose cards have
// been studied over the past month, generated with the real scheduler so the history
// is consistent. Seeded, so every run produces the same data. Test data only — it is
// never shipped in the app.

const DAY = 86_400_000;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idCounter = 0;
function uuid7(at: number): string {
  idCounter += 1;
  const ms = at.toString(16).padStart(12, '0');
  const tail = idCounter.toString(16).padStart(12, '0');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7000-8000-${tail}`;
}

/** One card of each M6 type (BUILD_BRIEF_M6_M8 §6.1), in the order they're studied. */
export const TYPED_CARDS: CardContent[] = [
  {
    type: 'mcq',
    question: 'Which normal form removes partial dependencies on a composite key?',
    options: [
      { id: 'a', text: 'First normal form (1NF)' },
      { id: 'b', text: 'Second normal form (2NF)' },
      { id: 'c', text: 'Third normal form (3NF)' },
      { id: 'd', text: 'Boyce–Codd normal form (BCNF)' },
    ],
    correct: 'b',
    explanation: '2NF requires every non-key attribute to depend on the whole candidate key.',
  },
  {
    type: 'cloze',
    text: 'In SQL, the {{GROUP BY}} clause collects rows that share a value so aggregates can be computed per group.',
    accepted: ['group-by'],
    hint: 'Two words',
    extra: 'HAVING then filters the groups, as WHERE filters rows.',
  },
  {
    type: 'short',
    question: 'What is a view in SQL?',
    answer: 'A virtual table defined by a stored query; it holds no data of its own.',
    explanation: 'Querying a view runs its defining query against the base tables.',
  },
  {
    type: 'long',
    question: 'Explain the ACID properties of a transaction.',
    marks: 6,
    keyPoints: [
      'Atomicity: all of the transaction happens, or none of it',
      'Consistency: it takes the database from one valid state to another',
      'Isolation: concurrent transactions don’t see each other’s partial work',
      'Durability: once committed, changes survive crashes',
    ],
    modelAnswer:
      'A transaction is a unit of work. Atomicity is ensured by undo logging, durability by the write-ahead log and isolation by concurrency control such as locking.',
  },
];

const DECKS: { name: string; cards: [string, string][] }[] = [
  {
    name: 'Operating Systems',
    cards: [
      ['What is a process?', 'A program in execution, with its own address space and resources.'],
      [
        'What is a thread?',
        'The smallest unit of execution; threads of a process share its memory.',
      ],
      ['What is a context switch?', 'Saving one task’s CPU state and loading another’s.'],
      [
        'What causes a deadlock?',
        'Mutual exclusion, hold and wait, no preemption, and circular wait together.',
      ],
      ['What does a page table map?', 'Virtual page numbers to physical frame numbers.'],
      ['What is thrashing?', 'Spending most of the time paging instead of doing useful work.'],
      ['What is a semaphore?', 'A counter used to control access to a shared resource.'],
      [
        'What is a race condition?',
        'An outcome that depends on the timing of concurrent operations.',
      ],
      [
        'What is virtual memory?',
        'An abstraction that gives each process its own large address space.',
      ],
      ['What is a system call?', 'A request from a program to the operating system kernel.'],
    ],
  },
  {
    name: 'Data Structures',
    cards: [
      ['Average lookup time in a hash table?', 'O(1).'],
      ['What is a stack?', 'A last-in, first-out collection.'],
      ['What is a queue?', 'A first-in, first-out collection.'],
      ['Height of a balanced binary search tree with n nodes?', 'O(log n).'],
      ['What is a heap used for?', 'Quickly finding the minimum or maximum element.'],
      ['Worst-case time of quicksort?', 'O(n²).'],
      ['What is a linked list?', 'Nodes where each one points to the next.'],
      ['What does BFS use to track the frontier?', 'A queue.'],
    ],
  },
  {
    name: 'Discrete Mathematics',
    cards: [
      ['What is a bijection?', 'A function that is both one-to-one and onto.'],
      ['How many subsets does a set of n elements have?', '2ⁿ.'],
      ['What is a tautology?', 'A statement that is true under every interpretation.'],
      ['What is the pigeonhole principle?', 'If n+1 items go into n boxes, some box holds two.'],
      ['What is a partial order?', 'A reflexive, antisymmetric and transitive relation.'],
      [
        'What is mathematical induction?',
        'Prove a base case, then that each case implies the next.',
      ],
    ],
  },
];

export interface SeedBackup {
  format: 'recall-backup';
  version: 2;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
}

/**
 * @param now   the fixed "now" the browser will use
 * @param studiedFraction share of each deck's cards that have been studied before
 */
export function buildSeedBackup(now: number, studiedFraction = 0.75): SeedBackup {
  const rand = rng(20261010);
  const decks: Deck[] = [];
  const cards: Card[] = [];
  const reviewLogs: ReviewLog[] = [];
  const start = now - 32 * DAY;

  for (const spec of DECKS) {
    const deck: Deck = {
      id: uuid7(start),
      name: spec.name,
      source: 'user',
      prebuiltId: null,
      catalogSlug: null,
      catalogVersion: null,
      createdAt: start,
      updatedAt: start,
      deletedAt: null,
    };
    decks.push(deck);
    spec.cards.forEach(([front, back], i) => {
      const card: Card = {
        id: uuid7(start + i),
        deckId: deck.id,
        ...cardFields({ type: 'basic', front: front, back: back }),
        unit: null,
        sourceKey: null,
        sourceHash: null,
        createdAt: start + i,
        updatedAt: start + i,
        deletedAt: null,
      };
      cards.push(card);
      if (i >= Math.round(spec.cards.length * studiedFraction)) return; // never studied
      // First seen on some day in the past month, at a plausible hour.
      let at = now - Math.floor(4 + rand() * 26) * DAY + Math.floor(rand() * 10) * 3_600_000;
      let state = initialState(card);
      for (let n = 0; n < 12 && at < now - 3_600_000; n++) {
        const r = rand();
        const rating = state.state === 'new' ? 3 : r < 0.1 ? 1 : r < 0.2 ? 2 : r < 0.9 ? 3 : 4;
        const log: ReviewLog = {
          id: uuid7(at),
          cardId: card.id,
          rating,
          reviewedAt: at,
          durationMs: 4000 + Math.floor(rand() * 9000),
          deviceId: 'seed',
          voidedAt: null,
          outcome: null,
        };
        reviewLogs.push(log);
        state = applyReview(state, log);
        // Next review when it comes due (learning steps within minutes).
        at = Math.max(state.due, at + 60_000);
      }
    });
  }
  // M6: one never-studied card of each new type, for the review screens.
  const typedDeck: Deck = {
    id: uuid7(start),
    name: 'Question types',
    source: 'user',
    prebuiltId: null,
    catalogSlug: null,
    catalogVersion: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  };
  decks.push(typedDeck);
  TYPED_CARDS.forEach((content, i) => {
    cards.push({
      id: uuid7(start + i),
      deckId: typedDeck.id,
      ...cardFields(content),
      unit: null,
      sourceKey: null,
      sourceHash: null,
      createdAt: start + i,
      updatedAt: start + i,
      deletedAt: null,
    });
  });
  return { format: 'recall-backup', version: 2, exportedAt: now, decks, cards, reviewLogs };
}

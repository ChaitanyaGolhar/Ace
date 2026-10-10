import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deckFile, type CardJson } from '../support/catalog';

// The Robbins ch. 3 deck (1,014 cards), bundled with the app before M7, as a store deck.
// Card text and order are unchanged; keys allow 999 cards per unit, so it spans units 1–2.

interface LegacyDeck {
  name: string;
  cards: { front: string; back: string }[];
}

const legacy = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'content',
      'legacy-decks',
      'robbins-ch3-inflammation-repair-v1.json',
    ),
    'utf8',
  ),
) as LegacyDeck;

export const ROBBINS_SUBJECT = 'Pathology (Robbins Ch. 3 — Inflammation and Repair)';

export function robbinsCatalogFile(slug: string): Record<string, unknown> {
  const cards: CardJson[] = legacy.cards.map((c, i) => {
    const unit = Math.floor(i / 999) + 1;
    return {
      key: `u${String(unit)}-${String((i % 999) + 1).padStart(3, '0')}`,
      unit,
      type: 'basic',
      front: c.front,
      back: c.back,
    };
  });
  return deckFile({
    slug,
    subject: ROBBINS_SUBJECT,
    title: legacy.name,
    year: 'SE',
    semester: 3,
    branches: ['MBBS'],
    units: [
      { number: 1, title: 'Inflammation' },
      { number: 2, title: 'Repair' },
    ],
    cards,
  });
}

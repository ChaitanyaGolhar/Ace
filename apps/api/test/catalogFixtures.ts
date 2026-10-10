import { validateDeckFile, type CardContent, type DeckFile } from '@recall/core';

// Catalog deck files for API and CLI tests (BUILD_BRIEF_M6_M8 §7.2).

export type FileCard = [key: string, unit: number, content: CardContent];

export const basic = (front: string, back = `${front} — answer`): CardContent => ({
  type: 'basic',
  front,
  back,
});

export function rawDeckFile(
  overrides: Record<string, unknown> = {},
  cards: FileCard[] = [
    ['u1-001', 1, basic('What is a DBMS?')],
    ['u1-002', 1, basic('What is a primary key?')],
    ['u2-001', 2, basic('What is a view?')],
  ],
): Record<string, unknown> {
  const { catalog, ...rest } = overrides;
  return {
    format: 'ace-deck@2',
    slug: 'sppu-te-cse-dbms',
    version: 1,
    title: 'Database Management Systems',
    description: 'Unit-wise revision for SPPU TE.',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE', 'CSE-DS'],
      subject: 'Database Management Systems',
      subjectCodes: { CSE: 'PCC301COM', 'CSE-DS': 'PCC301CDS' },
      units: [
        { number: 1, title: 'Introduction' },
        { number: 2, title: 'Relational model' },
      ],
      ...(catalog as Record<string, unknown> | undefined),
    },
    price: 0,
    author: 'Chaitanya Golhar',
    reviewedBy: null,
    lastVerifiedAt: '2026-10-11',
    cards: cards.map(([key, unit, content]) => ({ key, unit, ...content })),
    ...rest,
  };
}

export function deckFile(overrides: Record<string, unknown> = {}, cards?: FileCard[]): DeckFile {
  const result = validateDeckFile(rawDeckFile(overrides, cards));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.deck;
}

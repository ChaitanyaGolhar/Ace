import { describe, expect, it } from 'vitest';
import type { CatalogDeckSummary } from '@recall/core';
import {
  branchesIn,
  filterStoreDecks,
  formatPrice,
  semestersFor,
  subjectCodeLabel,
  typesLabel,
  unitRange,
} from '../src/features/store/storeView';

// The store's list logic (BUILD_BRIEF_M6_M8 §7.7), kept pure so it's easy to test.

function summary(over: Partial<CatalogDeckSummary> & { slug: string }): CatalogDeckSummary {
  return {
    version: 1,
    title: 'T',
    description: 'd',
    catalog: {
      university: 'SPPU',
      pattern: '2024',
      year: 'TE',
      semester: 5,
      branches: ['CSE'],
      subject: 'Subject',
      subjectCodes: { CSE: null },
    },
    units: [{ number: 1, title: 'One', cardCount: 3 }],
    price: 0,
    author: 'A',
    reviewedBy: null,
    lastVerifiedAt: '2026-10-11',
    cardCount: 3,
    typeCounts: { basic: 3, mcq: 0, cloze: 0, short: 0, long: 0 },
    ...over,
  };
}

const dbms = summary({
  slug: 'dbms',
  catalog: {
    university: 'SPPU',
    pattern: '2024',
    year: 'TE',
    semester: 5,
    branches: ['CSE', 'CSE-DS'],
    subject: 'Database Management Systems',
    subjectCodes: { CSE: 'PCC301COM', 'CSE-DS': 'PCC301CDS' },
  },
});
const ml = summary({
  slug: 'ml',
  catalog: {
    university: 'SPPU',
    pattern: '2024',
    year: 'TE',
    semester: 6,
    branches: ['AIDS'],
    subject: 'Machine Learning',
    subjectCodes: { AIDS: null },
  },
});
const dsa = summary({
  slug: 'dsa',
  catalog: {
    university: 'SPPU',
    pattern: '2019',
    year: 'SE',
    semester: 3,
    branches: ['CSE'],
    subject: 'Data Structures',
    subjectCodes: { CSE: null },
  },
});
const all = [dsa, dbms, ml];

describe('filterStoreDecks', () => {
  const none = { year: null, semester: null, branch: null };
  it('no filters: everything', () => {
    expect(filterStoreDecks(all, none, '').map((d) => d.slug)).toEqual(['dsa', 'dbms', 'ml']);
  });
  it('year, semester and branch', () => {
    expect(filterStoreDecks(all, { ...none, year: 'TE' }, '').map((d) => d.slug)).toEqual([
      'dbms',
      'ml',
    ]);
    expect(filterStoreDecks(all, { ...none, semester: 6 }, '').map((d) => d.slug)).toEqual(['ml']);
    expect(filterStoreDecks(all, { ...none, branch: 'CSE' }, '').map((d) => d.slug)).toEqual([
      'dsa',
      'dbms',
    ]);
  });
  it('search by subject, case-insensitive, ignoring extra spaces', () => {
    expect(filterStoreDecks(all, none, '  machine ').map((d) => d.slug)).toEqual(['ml']);
    expect(filterStoreDecks(all, none, 'DATA').map((d) => d.slug)).toEqual(['dsa', 'dbms']);
  });
});

describe('chip options', () => {
  it('semesters follow the year; with no year, every semester in the catalog', () => {
    expect(semestersFor('FE', all)).toEqual([1, 2]);
    expect(semestersFor('TE', all)).toEqual([5, 6]);
    expect(semestersFor('BE', all)).toEqual([7, 8]);
    expect(semestersFor(null, all)).toEqual([3, 5, 6]);
  });
  it('branches present in the catalog, sorted', () => {
    expect(branchesIn(all)).toEqual(['AIDS', 'CSE', 'CSE-DS']);
  });
});

describe('labels', () => {
  it('unit range', () => {
    expect(unitRange([{ number: 1, title: 'A', cardCount: 1 }])).toBe('Unit 1');
    expect(
      unitRange([
        { number: 1, title: 'A', cardCount: 1 },
        { number: 2, title: 'B', cardCount: 1 },
        { number: 5, title: 'C', cardCount: 1 },
      ]),
    ).toBe('Units 1–5');
  });
  it('types present, in the usual order', () => {
    expect(typesLabel({ basic: 2, mcq: 4, cloze: 0, short: 0, long: 1 })).toBe(
      'Basic, Multiple choice, Long answer',
    );
  });
  it('subject code: the filtered branch’s, else every branch that has one', () => {
    expect(subjectCodeLabel(dbms.catalog.subjectCodes, 'CSE-DS')).toBe('PCC301CDS');
    expect(subjectCodeLabel(dbms.catalog.subjectCodes, null)).toBe(
      'CSE: PCC301COM · CSE-DS: PCC301CDS',
    );
    expect(subjectCodeLabel({ CSE: 'X', AIDS: null }, null)).toBe('CSE: X');
    expect(subjectCodeLabel({ AIDS: null }, 'AIDS')).toBeNull();
    expect(subjectCodeLabel({ CSE: 'X' }, 'ECE')).toBe('CSE: X');
  });
  it('price', () => {
    expect(formatPrice(0)).toBe('Free');
    expect(formatPrice(4900)).toBe('₹49');
    expect(formatPrice(4950)).toBe('₹49.50');
  });
});

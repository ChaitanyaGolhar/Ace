import { CARD_TYPES, type CardType, type CatalogDeckSummary } from '@recall/core';
import type { StoreFilters } from '../../db/meta';

// The store's list logic (BUILD_BRIEF_M6_M8 §7.7): filters, chip options and labels.

export const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;
const YEAR_SEMESTERS: Record<string, [number, number]> = {
  FE: [1, 2],
  SE: [3, 4],
  TE: [5, 6],
  BE: [7, 8],
};

export const TYPE_NAMES: Record<CardType, string> = {
  basic: 'Basic',
  mcq: 'Multiple choice',
  cloze: 'Fill in the blank',
  short: 'Short answer',
  long: 'Long answer',
};

export function filterStoreDecks(
  decks: readonly CatalogDeckSummary[],
  filters: StoreFilters,
  search: string,
): CatalogDeckSummary[] {
  const q = search.trim().replace(/\s+/g, ' ').toLowerCase();
  return decks.filter(
    (d) =>
      (filters.year === null || d.catalog.year === filters.year) &&
      (filters.semester === null || d.catalog.semester === filters.semester) &&
      (filters.branch === null || d.catalog.branches.includes(filters.branch)) &&
      (q === '' || d.catalog.subject.toLowerCase().includes(q)),
  );
}

/** The semester chips: the chosen year's two, or every semester in the catalog. */
export function semestersFor(year: string | null, decks: readonly CatalogDeckSummary[]): number[] {
  const range = year === null ? undefined : YEAR_SEMESTERS[year];
  if (range) return [...range];
  return [...new Set(decks.map((d) => d.catalog.semester))].sort((a, b) => a - b);
}

export function branchesIn(decks: readonly CatalogDeckSummary[]): string[] {
  return [...new Set(decks.flatMap((d) => d.catalog.branches))].sort();
}

export function unitRange(units: CatalogDeckSummary['units']): string {
  const numbers = units.map((u) => u.number).sort((a, b) => a - b);
  const first = numbers[0];
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) return '';
  return first === last ? `Unit ${String(first)}` : `Units ${String(first)}–${String(last)}`;
}

export function typesLabel(counts: CatalogDeckSummary['typeCounts']): string {
  return CARD_TYPES.filter((t) => counts[t] > 0)
    .map((t) => TYPE_NAMES[t])
    .join(', ');
}

/**
 * The subject code to show (§7.7): the code for the branch the student filtered by, or
 * every branch's code ("CSE: X · CSE-DS: Y"). Branches without a code are left out.
 */
export function subjectCodeLabel(
  codes: Record<string, string | null>,
  branch: string | null,
): string | null {
  if (branch !== null && branch in codes) return codes[branch] ?? null;
  const all = Object.entries(codes).filter((e): e is [string, string] => e[1] !== null);
  return all.length === 0 ? null : all.map(([b, c]) => `${b}: ${c}`).join(' · ');
}

export function formatPrice(paise: number): string {
  if (paise === 0) return 'Free';
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2)}`;
}

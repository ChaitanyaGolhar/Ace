import { formatCount } from './format';

/** The deck page shows cards a page at a time (DECISIONS D-317). */
export const CARD_PAGE_SIZE = 100;

export interface CardPage<T> {
  visible: T[];
  /** "Showing 100 of 1,000 cards", or null when every row is shown. */
  shownLabel: string | null;
  /** How many the "Show more" button adds (0: no button). */
  more: number;
}

export function pageOfCards<T>(rows: readonly T[], limit: number): CardPage<T> {
  const visible = rows.slice(0, limit);
  const remaining = rows.length - visible.length;
  return {
    visible,
    shownLabel:
      remaining > 0
        ? `Showing ${formatCount(visible.length)} of ${formatCount(rows.length)} cards`
        : null,
    more: Math.min(CARD_PAGE_SIZE, remaining),
  };
}

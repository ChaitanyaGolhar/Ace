import type { DeckSummary } from '../../services/overview';
import { formatCount } from '../../services/format';

export interface DeckRow {
  id: string;
  name: string;
  /** "1,014 cards · Ready-made" */
  meta: string;
  /** Review + learning cards due today; 0 = "Up to date". */
  due: number;
  /** M7: a store deck with a newer version out. */
  update: boolean;
}

function plural(n: number, word: string) {
  return `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Deck list rows, shared by Home and the Decks page. */
export function toDeckRows(decks: DeckSummary[]): DeckRow[] {
  return decks.map((d) => ({
    id: d.id,
    name: d.name,
    meta: `${plural(d.cardCount, 'card')}${
      d.source === 'prebuilt' ? ' · Ready-made' : d.source === 'catalog' ? ' · From the store' : ''
    }`,
    due: d.counts.due + d.counts.learning,
    update: d.updateAvailable,
  }));
}

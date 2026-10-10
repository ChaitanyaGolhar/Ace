import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { loadHome, type DeckSummary } from '../../services/overview';

export interface HomeViewModel {
  status: 'loading' | 'error' | 'ready';
  /** First-time user: no decks at all. */
  isEmpty: boolean;
  counts: { due: number; new: number; learning: number };
  /** Anything to study right now (due, new or learning)? */
  canStudy: boolean;
  decks: DeckSummary[];
}

export function useHome(): HomeViewModel {
  const { ctx, browserTimeZone } = useServices();
  const query = useQuery(() => loadHome(ctx, { browserTimeZone }), [ctx, browserTimeZone]);
  if (query.status !== 'ready') {
    return {
      status: query.status,
      isEmpty: false,
      counts: { due: 0, new: 0, learning: 0 },
      canStudy: false,
      decks: [],
    };
  }
  const { counts, decks } = query.data;
  return {
    status: 'ready',
    isEmpty: decks.length === 0,
    counts,
    canStudy: counts.due + counts.new + counts.learning > 0,
    decks,
  };
}

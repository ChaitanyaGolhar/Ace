import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { loadHome } from '../../services/overview';
import { toDeckRows, type DeckRow } from '../home/deckRows';

export interface DecksViewModel {
  status: 'loading' | 'error' | 'ready';
  decks: DeckRow[];
}

/** Decks page: the Home deck list pattern on its own page. */
export function useDecks(): DecksViewModel {
  const { ctx, browserTimeZone } = useServices();
  const query = useQuery(() => loadHome(ctx, { browserTimeZone }), [ctx, browserTimeZone]);
  return {
    status: query.status,
    decks: query.status === 'ready' ? toDeckRows(query.data.decks) : [],
  };
}

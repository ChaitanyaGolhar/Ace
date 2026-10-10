import { useState } from 'react';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { searchEverything, type SearchResults } from '../../services/search';

export interface SearchViewModel {
  query: string;
  status: 'idle' | 'loading' | 'error' | 'ready';
  results: SearchResults;
  setQuery: (q: string) => void;
}

/** Global search across deck names and card questions/answers. */
export function useSearch(): SearchViewModel {
  const { ctx } = useServices();
  const [query, setQuery] = useState('');
  const results = useQuery(() => searchEverything(ctx, query), [ctx, query]);
  const empty = { decks: [], cards: [] };
  return {
    query,
    status: query.trim() === '' ? 'idle' : results.status,
    results: results.status === 'ready' ? results.data : empty,
    setQuery,
  };
}

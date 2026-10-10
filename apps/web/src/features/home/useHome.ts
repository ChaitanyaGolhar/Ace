import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { greetingFor } from '../../services/greeting';
import { loadHome } from '../../services/overview';
import { isPlainShortcut } from '../shell/keyboard';
import { toDeckRows, type DeckRow } from './deckRows';

export type { DeckRow };

export interface HomeViewModel {
  status: 'loading' | 'error' | 'ready';
  /** Zero decks: show the first-visit welcome instead. */
  isFirstVisit: boolean;
  greeting: string;
  /** Today's study panel. */
  total: number;
  reviews: number;
  newCount: number;
  /** "about N minutes", or null with too little review history. */
  estimateMinutes: number | null;
  tomorrow: number;
  canStudy: boolean;
  decks: DeckRow[];
  startReviewing: () => void;
}

export function useHome(): HomeViewModel {
  const { ctx, browserTimeZone } = useServices();
  const navigate = useNavigate();
  const query = useQuery(() => loadHome(ctx, { browserTimeZone }), [ctx, browserTimeZone]);

  const data = query.status === 'ready' ? query.data : null;
  const total = data ? data.counts.due + data.counts.learning + data.counts.new : 0;
  const canStudy = total > 0;

  const startReviewing = () => {
    void navigate('/study');
  };

  // Space starts reviewing (desktop); never while typing.
  useEffect(() => {
    if (!canStudy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !isPlainShortcut(e)) return;
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
      e.preventDefault();
      void navigate('/study');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canStudy, navigate]);

  return {
    status: query.status,
    isFirstVisit: data !== null && data.decks.length === 0,
    greeting: greetingFor(ctx.now(), browserTimeZone),
    total,
    reviews: data ? data.counts.due + data.counts.learning : 0,
    newCount: data?.counts.new ?? 0,
    estimateMinutes: data?.estimateMinutes ?? null,
    tomorrow: data?.tomorrow ?? 0,
    canStudy,
    decks: toDeckRows(data?.decks ?? []),
    startReviewing,
  };
}

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { noteBreakReturnShown, SESSION_CAP, type BreakReturn } from '../../services/breakReturn';
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
  /** Feel pass: back after a break with many cards due ("Welcome back"), or null. */
  breakReturn: BreakReturn | null;
  /** "Start with 20". */
  cap: number;
  startCapped: () => void;
}

export function useHome(): HomeViewModel {
  const { ctx, browserTimeZone } = useServices();
  const navigate = useNavigate();
  const query = useQuery(() => loadHome(ctx, { browserTimeZone }), [ctx, browserTimeZone]);

  const data = query.status === 'ready' ? query.data : null;
  const total = data ? data.counts.due + data.counts.learning + data.counts.new : 0;
  const canStudy = total > 0;

  const breakReturn = data?.breakReturn ?? null;
  const startReviewing = () => {
    void navigate('/study');
  };
  const startCapped = () => {
    void navigate(`/study?cap=${String(SESSION_CAP)}`);
  };

  // Recorded once per study day, however often Home is shown.
  const shownDue = breakReturn?.due;
  const shownDaysAway = breakReturn?.daysAway;
  useEffect(() => {
    if (shownDue === undefined || shownDaysAway === undefined) return;
    void noteBreakReturnShown(ctx, { due: shownDue, daysAway: shownDaysAway }, browserTimeZone);
  }, [ctx, browserTimeZone, shownDue, shownDaysAway]);

  // Space starts the primary action (desktop): reviewing, or after a break, the first 20.
  // Never while typing.
  const capped = breakReturn !== null;
  useEffect(() => {
    if (!canStudy) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !isPlainShortcut(e)) return;
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
      e.preventDefault();
      void navigate(capped ? `/study?cap=${String(SESSION_CAP)}` : '/study');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canStudy, capped, navigate]);

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
    breakReturn,
    cap: SESSION_CAP,
    startCapped,
  };
}

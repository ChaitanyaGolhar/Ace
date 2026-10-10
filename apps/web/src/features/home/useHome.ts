import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { WELCOME_DECKS } from '../../content/readyMade';
import { greetingFor } from '../../services/greeting';
import { loadHome, type DeckSummary } from '../../services/overview';
import type { PrebuiltDeck } from '@recall/core';
import { addReadyMadeDeck } from '../../services/readyMade';
import { isPlainShortcut } from '../shell/keyboard';

export interface DeckRow {
  id: string;
  name: string;
  /** "20 cards · Ready-made" */
  meta: string;
  /** Review + learning cards due today; 0 = "Up to date". */
  due: number;
}

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
  /** First ready-made deck for the welcome card (null: no ready-made decks bundled). */
  /** First visit: every bundled deck, in welcome order. */
  featured: readonly PrebuiltDeck[];
  hasReadyMade: boolean;
  /** The prebuiltId being added, while it is. */
  adding: string | null;
  addError: string | null;
  startReviewing: () => void;
  /** Welcome: add that deck and go straight into the review session. */
  addAndStart: (prebuiltId: string) => void;
}

function plural(n: number, word: string) {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Deck list rows, shared by Home and the Decks page. */
export function toDeckRows(decks: DeckSummary[]): DeckRow[] {
  return decks.map((d) => ({
    id: d.id,
    name: d.name,
    meta: `${plural(d.cardCount, 'card')}${d.source === 'prebuilt' ? ' · Ready-made' : ''}`,
    due: d.counts.due + d.counts.learning,
  }));
}

export function useHome(): HomeViewModel {
  const { ctx, browserTimeZone } = useServices();
  const navigate = useNavigate();
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
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

  const featured = WELCOME_DECKS;
  const addAndStart = (prebuiltId: string) => {
    const source = featured.find((d) => d.prebuiltId === prebuiltId);
    if (!source || adding !== null) return;
    setAdding(prebuiltId);
    setAddError(null);
    addReadyMadeDeck(ctx, source)
      .then((deck) => navigate(`/study?deck=${deck.id}`))
      .catch(() => {
        setAddError('Couldn’t add the deck. Please try again.');
        setAdding(null);
      });
  };

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
    featured,
    hasReadyMade: WELCOME_DECKS.length > 0,
    adding,
    addError,
    startReviewing,
    addAndStart,
  };
}

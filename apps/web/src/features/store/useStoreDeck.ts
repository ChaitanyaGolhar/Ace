import { useEffect, useRef, useState } from 'react';
import type { CatalogDeckSummary, DeckFileCard } from '@recall/core';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useToasts } from '../../app/toasts';
import { useQuery } from '../../app/useQuery';
import { getMeta } from '../../db/meta';
import { addCatalogDeck, CatalogOfflineError, ownedCatalogSlugs } from '../../services/catalog';
import { CatalogNotFoundError } from '../../services/catalogHttp';
import { recordEvent } from '../../services/events';

// A deck's store page (BUILD_BRIEF_M6_M8 §7.7).

export const OFFLINE_ADD_MESSAGE = 'Connect to the internet to add decks.';

export interface StoreDeckViewModel {
  status: 'loading' | 'error' | 'notFound' | 'ready';
  deck: CatalogDeckSummary | null;
  /** Null offline (samples need the network). */
  samples: DeckFileCard[] | null;
  offline: boolean;
  inMyDecks: boolean;
  adding: boolean;
  addError: string | null;
  /** The duplicate sheet is open. */
  confirming: boolean;
  add: () => void;
  addSecondCopy: () => void;
  keepOneCopy: () => void;
}

export function useStoreDeck(slug: string): StoreDeckViewModel {
  const { ctx, catalog, isOnline } = useServices();
  const navigate = useNavigate();
  const toasts = useToasts();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'notFound' }
    | {
        status: 'ready';
        deck: CatalogDeckSummary;
        samples: DeckFileCard[] | null;
        offline: boolean;
      }
  >({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const viewed = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    const load = async () => {
      try {
        const detail = await catalog.detail(slug);
        return {
          status: 'ready' as const,
          deck: detail.deck,
          samples: detail.samples,
          offline: false,
        };
      } catch (error) {
        if (error instanceof CatalogNotFoundError) return { status: 'notFound' as const };
        if (!(error instanceof CatalogOfflineError)) throw error;
        const cached = (await getMeta(ctx.db, 'catalogCache'))?.decks.find((d) => d.slug === slug);
        return cached
          ? { status: 'ready' as const, deck: cached, samples: null, offline: true }
          : { status: 'notFound' as const };
      }
    };
    load().then(
      (next) => {
        if (cancelled) return;
        setState(next);
        if (next.status === 'ready' && viewed.current !== slug) {
          viewed.current = slug;
          void recordEvent(ctx, 'catalog_deck_viewed', { slug }).catch(() => undefined);
        }
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, catalog, slug]);

  const owned = useQuery(() => ownedCatalogSlugs(ctx), [ctx]);
  const inMyDecks = owned.status === 'ready' && owned.data.has(slug);
  const deck = state.status === 'ready' ? state.deck : null;
  const offline = (state.status === 'ready' && state.offline) || !isOnline();

  const doAdd = () => {
    if (!deck || adding) return;
    setConfirming(false);
    if (!isOnline()) {
      setAddError(OFFLINE_ADD_MESSAGE);
      return;
    }
    setAdding(true);
    setAddError(null);
    addCatalogDeck(ctx, catalog, deck.slug, deck.version)
      .then((created) => {
        toasts.show({ message: `Added ${created.name}` });
        return navigate(`/decks/${created.id}`);
      })
      .catch((error: unknown) => {
        setAddError(
          error instanceof CatalogOfflineError
            ? OFFLINE_ADD_MESSAGE
            : 'Couldn’t add the deck. Please try again.',
        );
      })
      .finally(() => {
        setAdding(false);
      });
  };

  return {
    status: state.status,
    deck,
    samples: state.status === 'ready' ? state.samples : null,
    offline,
    inMyDecks,
    adding,
    addError,
    confirming,
    add: () => {
      // Adding the same deck twice warns first (§7.5, as for ready-made decks).
      if (inMyDecks) setConfirming(true);
      else doAdd();
    },
    addSecondCopy: doAdd,
    keepOneCopy: () => {
      setConfirming(false);
    },
  };
}

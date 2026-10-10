import { useEffect, useRef, useState } from 'react';
import type { CatalogDeckSummary, DeckFileCard } from '@recall/core';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useToasts } from '../../app/toasts';
import { useQuery } from '../../app/useQuery';
import { getMeta } from '../../db/meta';
import { addCatalogDeck, CatalogOfflineError, ownedCatalogSlugs } from '../../services/catalog';
import { CatalogNotFoundError } from '../../services/catalogHttp';
import { RedeemFailedError, redeemAndAdd, refreshEntitlements } from '../../services/entitlements';
import { recordEvent } from '../../services/events';

// A deck's store page (BUILD_BRIEF_M6_M8 §7.7), with the purchase section of paid decks (§8.4).

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
  // M8 (§8.4): paid decks.
  paid: boolean;
  signedIn: boolean;
  /** This account unlocked it ("Owned"). */
  owned: boolean;
  /** "How to buy", from the server; null while loading or offline. */
  purchaseInfo: string | null;
  code: string;
  redeeming: boolean;
  redeemError: string | null;
  setCode: (code: string) => void;
  redeem: () => void;
}

export function useStoreDeck(slug: string): StoreDeckViewModel {
  const { ctx, catalog, entitlements, isOnline } = useServices();
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [purchaseInfo, setPurchaseInfo] = useState<string | null>(null);
  const infoViewed = useRef<string | null>(null);
  const auth = useQuery(() => getMeta(ctx.db, 'auth'), [ctx]);
  const signedIn = auth.status === 'ready' && auth.data?.signedIn === true;
  const ownedQuery = useQuery(() => getMeta(ctx.db, 'entitlements'), [ctx]);
  const unlocked = ownedQuery.status === 'ready' && (ownedQuery.data ?? []).includes(slug);
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

  const paid = deck !== null && deck.price > 0;

  // Signed in on this device: which paid decks does the account own? ("Owned — Add").
  useEffect(() => {
    if (!signedIn || !paid) return;
    void refreshEntitlements(ctx, entitlements).catch(() => undefined);
  }, [ctx, entitlements, signedIn, paid]);

  // "How to buy" comes from the server's config, never from the app.
  useEffect(() => {
    if (!paid || unlocked) return;
    let cancelled = false;
    entitlements.purchaseInfo().then(
      ({ instructions }) => {
        if (cancelled) return;
        setPurchaseInfo(instructions);
        if (infoViewed.current !== slug) {
          infoViewed.current = slug;
          void recordEvent(ctx, 'purchase_info_viewed', { slug }).catch(() => undefined);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, entitlements, paid, unlocked, slug]);

  const redeem = () => {
    if (!deck || redeeming) return;
    if (code.trim() === '') {
      setRedeemError('Type the code you received.');
      return;
    }
    setRedeeming(true);
    setRedeemError(null);
    redeemAndAdd(ctx, entitlements, catalog, code, { slug: deck.slug, version: deck.version })
      .then(({ added }) => {
        setCode('');
        toasts.show({ message: added ? `Unlocked — added ${added.name}` : 'Unlocked' });
        return added ? navigate(`/decks/${added.id}`) : undefined;
      })
      .catch((error: unknown) => {
        setRedeemError(
          error instanceof RedeemFailedError
            ? error.message
            : 'Something went wrong. Please try again.',
        );
      })
      .finally(() => {
        setRedeeming(false);
      });
  };

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
    paid,
    signedIn,
    owned: unlocked,
    purchaseInfo,
    code,
    redeeming,
    redeemError,
    setCode: (next) => {
      setCode(next);
      setRedeemError(null);
    },
    redeem,
  };
}

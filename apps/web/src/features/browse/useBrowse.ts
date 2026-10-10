import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { READY_MADE_DECKS } from '../../content/readyMade';
import { addReadyMadeDeck, readyMadeStatus, type ReadyMadeDeck } from '../../services/readyMade';

export interface BrowseRow {
  prebuiltId: string;
  name: string;
  description: string;
  cardCount: number;
  /** A live copy is already in the user's decks: "✓ In your decks". */
  inMyDecks: boolean;
}

export interface BrowseViewModel {
  status: 'loading' | 'error' | 'ready';
  decks: BrowseRow[];
  /** The deck the duplicate warning is asking about, or null when it's closed. */
  confirming: { prebuiltId: string; name: string } | null;
  adding: boolean;
  error: string | null;
  add: (prebuiltId: string) => void;
  addSecondCopy: () => void;
  keepOneCopy: () => void;
}

export function useBrowse(catalog: readonly ReadyMadeDeck[] = READY_MADE_DECKS): BrowseViewModel {
  const { ctx } = useServices();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<BrowseViewModel['confirming']>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery(() => readyMadeStatus(ctx, catalog), [ctx, catalog]);

  const doAdd = (prebuiltId: string) => {
    const deck = catalog.find((d) => d.prebuiltId === prebuiltId);
    if (!deck || adding) return;
    setAdding(true);
    setError(null);
    addReadyMadeDeck(ctx, deck)
      .then((created) => navigate(`/decks/${created.id}`))
      .catch(() => {
        setError('Couldn’t add the deck. Please try again.');
      })
      .finally(() => {
        setAdding(false);
        setConfirming(null);
      });
  };

  const owned = status.status === 'ready' ? status.data : {};
  return {
    status: status.status,
    decks: catalog.map((d) => ({
      prebuiltId: d.prebuiltId,
      name: d.name,
      description: d.description,
      cardCount: d.cards.length,
      inMyDecks: owned[d.prebuiltId] ?? false,
    })),
    confirming,
    adding,
    error,
    add: (prebuiltId) => {
      // Adding the same deck twice warns first (§10, screen 6).
      if (owned[prebuiltId]) {
        const deck = catalog.find((d) => d.prebuiltId === prebuiltId);
        if (deck) setConfirming({ prebuiltId, name: deck.name });
        return;
      }
      doAdd(prebuiltId);
    },
    addSecondCopy: () => {
      if (confirming) doAdd(confirming.prebuiltId);
    },
    keepOneCopy: () => {
      setConfirming(null);
    },
  };
}

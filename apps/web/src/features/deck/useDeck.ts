import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useToasts } from '../../app/toasts';
import { useQuery } from '../../app/useQuery';
import { deleteCard } from '../../services/cards';
import { deleteDeck, renameDeck } from '../../services/decks';
import { UserInputError } from '../../services/errors';
import { loadDeckView, searchCards } from '../../services/overview';

export interface DeckCardRow {
  id: string;
  front: string;
  back: string;
}

export interface DeckViewModel {
  status: 'loading' | 'error' | 'notFound' | 'ready';
  deckId: string;
  name: string;
  counts: { due: number; new: number; learning: number };
  /** Total live cards in the deck (before search). */
  cardCount: number;
  /** Cards matching the search, minus cards whose delete is pending (undo toast). */
  cards: DeckCardRow[];
  search: string;
  canStudy: boolean;

  renaming: boolean;
  renameValue: string;
  renameError: string | null;
  confirmingDelete: boolean;

  setSearch: (q: string) => void;
  deleteCard: (cardId: string) => void;
  startRename: () => void;
  setRenameValue: (v: string) => void;
  saveRename: () => void;
  cancelRename: () => void;
  requestDeleteDeck: () => void;
  cancelDeleteDeck: () => void;
  confirmDeleteDeck: () => void;
}

export function useDeck(deckId: string): DeckViewModel {
  const { ctx, browserTimeZone, pendingDeletes } = useServices();
  const toasts = useToasts();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => pendingDeletes.subscribe(setPendingIds), [pendingDeletes]);

  const query = useQuery(
    () => loadDeckView(ctx, deckId, { browserTimeZone }),
    [ctx, deckId, browserTimeZone],
  );

  const actions = {
    setSearch,
    deleteCard: (cardId: string) => {
      // The tombstone is written only when the toast times out or is dismissed;
      // Undo cancels it. Tombstones themselves can never be undone (invariant 9).
      pendingDeletes.schedule(cardId, () => deleteCard(ctx, cardId));
      toasts.show({
        message: 'Card deleted',
        action: {
          label: 'Undo',
          onAction: () => {
            pendingDeletes.cancel(cardId);
          },
        },
        onClose: () => {
          void pendingDeletes.flush(cardId);
        },
        durationMs: 5000,
      });
    },
    startRename: () => {
      if (query.status === 'ready' && query.data) setRenameValue(query.data.deck.name);
      setRenameError(null);
      setRenaming(true);
    },
    setRenameValue: (v: string) => {
      setRenameValue(v);
      setRenameError(null);
    },
    saveRename: () => {
      renameDeck(ctx, deckId, renameValue)
        .then(() => {
          setRenaming(false);
        })
        .catch((e: unknown) => {
          setRenameError(e instanceof UserInputError ? e.message : 'Couldn’t rename the deck.');
        });
    },
    cancelRename: () => {
      setRenaming(false);
    },
    requestDeleteDeck: () => {
      setConfirmingDelete(true);
    },
    cancelDeleteDeck: () => {
      setConfirmingDelete(false);
    },
    confirmDeleteDeck: () => {
      deleteDeck(ctx, deckId)
        .then(() => {
          toasts.show({ message: 'Deck deleted' });
          return navigate('/');
        })
        .catch(() => {
          toasts.show({ message: 'Couldn’t delete the deck.' });
        });
    },
  };

  const base = {
    deckId,
    name: '',
    counts: { due: 0, new: 0, learning: 0 },
    cardCount: 0,
    cards: [],
    search,
    canStudy: false,
    renaming,
    renameValue,
    renameError,
    confirmingDelete,
    ...actions,
  };

  if (query.status === 'loading') return { ...base, status: 'loading' };
  if (query.status === 'error') return { ...base, status: 'error' };
  if (query.data === null) return { ...base, status: 'notFound' };

  const { deck, cards, counts } = query.data;
  const visible = cards.filter((c) => !pendingIds.has(c.id));
  return {
    ...base,
    status: 'ready',
    name: deck.name,
    counts,
    cardCount: visible.length,
    cards: searchCards(visible, search).map(({ id, front, back }) => ({ id, front, back })),
    canStudy: counts.due + counts.new + counts.learning > 0,
  };
}

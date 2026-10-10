import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useToasts } from '../../app/toasts';
import { useQuery } from '../../app/useQuery';
import { deleteCard } from '../../services/cards';
import { deleteDeck, renameDeck } from '../../services/decks';
import { cardDueLabel, lastStudiedLabel } from '../../services/dueLabels';
import { UserInputError } from '../../services/errors';
import { loadDeckView, searchCards } from '../../services/overview';

export interface DeckCardRow {
  id: string;
  front: string;
  /** "Due today", "Tomorrow", "In 3 days", "New"… */
  dueLabel: string;
  /** Emphasise "Due today". */
  isDue: boolean;
}

export interface DeckViewModel {
  status: 'loading' | 'error' | 'notFound' | 'ready';
  deckId: string;
  name: string;
  /** "20 cards · 6 due today · 4 new · last studied yesterday" */
  meta: string;
  isReadyMade: boolean;
  /** Total live cards in the deck (before search), minus pending deletes. */
  cardCount: number;
  /** Cards matching the search, oldest first. */
  cards: DeckCardRow[];
  search: string;
  canStudy: boolean;

  renameOpen: boolean;
  renameValue: string;
  renameError: string | null;
  deleteOpen: boolean;

  setSearch: (q: string) => void;
  editCard: (cardId: string) => void;
  deleteCard: (cardId: string) => void;
  openRename: () => void;
  setRenameValue: (v: string) => void;
  saveRename: () => void;
  closeRename: () => void;
  openDelete: () => void;
  closeDelete: () => void;
  confirmDelete: () => void;
}

function plural(n: number, word: string) {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

export function useDeck(deckId: string): DeckViewModel {
  const { ctx, browserTimeZone, pendingDeletes } = useServices();
  const toasts = useToasts();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => pendingDeletes.subscribe(setPendingIds), [pendingDeletes]);

  const query = useQuery(
    () => loadDeckView(ctx, deckId, { browserTimeZone }),
    [ctx, deckId, browserTimeZone],
  );
  const data = query.status === 'ready' ? query.data : null;

  const actions = {
    setSearch,
    editCard: (cardId: string) => {
      void navigate(`/cards/${cardId}/edit`);
    },
    deleteCard: (cardId: string) => {
      // The tombstone is written only when the toast times out or is dismissed; Undo
      // cancels it. Tombstones themselves can never be undone (invariant 9).
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
    openRename: () => {
      setRenameValue(data?.deck.name ?? '');
      setRenameError(null);
      setRenameOpen(true);
    },
    setRenameValue: (v: string) => {
      setRenameValue(v);
      setRenameError(null);
    },
    saveRename: () => {
      renameDeck(ctx, deckId, renameValue)
        .then(() => {
          setRenameOpen(false);
        })
        .catch((e: unknown) => {
          setRenameError(e instanceof UserInputError ? e.message : 'Couldn’t rename the deck.');
        });
    },
    closeRename: () => {
      setRenameOpen(false);
    },
    openDelete: () => {
      setDeleteOpen(true);
    },
    closeDelete: () => {
      setDeleteOpen(false);
    },
    confirmDelete: () => {
      deleteDeck(ctx, deckId)
        .then(() => {
          setDeleteOpen(false);
          toasts.show({ message: 'Deck deleted' });
          return navigate('/decks');
        })
        .catch(() => {
          toasts.show({ message: 'Couldn’t delete the deck.' });
        });
    },
  };

  const base = {
    deckId,
    name: '',
    meta: '',
    isReadyMade: false,
    cardCount: 0,
    cards: [],
    search,
    canStudy: false,
    renameOpen,
    renameValue,
    renameError,
    deleteOpen,
    ...actions,
  };

  if (query.status === 'loading') return { ...base, status: 'loading' };
  if (query.status === 'error') return { ...base, status: 'error' };
  if (data === null) return { ...base, status: 'notFound' };

  const { deck, cards, counts, lastStudiedAt, now, timeZone, rolloverHour } = data;
  const visible = cards.filter((c) => !pendingIds.has(c.id));
  const dueToday = counts.due + counts.learning;
  const lastStudied = lastStudiedLabel(lastStudiedAt, now, timeZone, rolloverHour);
  const meta = [
    plural(visible.length, 'card'),
    `${String(dueToday)} due today`,
    `${String(counts.new)} new`,
    ...(lastStudied ? [lastStudied] : []),
  ].join(' · ');

  return {
    ...base,
    status: 'ready',
    name: deck.name,
    meta,
    isReadyMade: deck.source === 'prebuilt',
    cardCount: visible.length,
    cards: searchCards(visible, search).map((c) => {
      const dueLabel = cardDueLabel(c.state, now, timeZone, rolloverHour);
      return { id: c.id, front: c.front, dueLabel, isDue: dueLabel === 'Due today' };
    }),
    canStudy: dueToday + counts.new > 0,
  };
}

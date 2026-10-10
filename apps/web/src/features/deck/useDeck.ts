import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useToasts } from '../../app/toasts';
import { useQuery } from '../../app/useQuery';
import type { DeckUpdatePlan } from '@recall/core';
import {
  availableUpdate,
  CatalogOfflineError,
  planCatalogUpdate,
  updateCatalogDeck,
  updateToast,
} from '../../services/catalog';
import { deleteCard } from '../../services/cards';
import { deleteDeck, renameDeck } from '../../services/decks';
import { cardDueLabel, lastStudiedLabel } from '../../services/dueLabels';
import { UserInputError } from '../../services/errors';
import { formatCount } from '../../services/format';
import { loadDeckView, searchCards } from '../../services/overview';
import { CARD_PAGE_SIZE, pageOfCards } from '../../services/paging';

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
  /** M7: a copy of a store deck. */
  isFromStore: boolean;
  /** Total live cards in the deck (before search), minus pending deletes. */
  cardCount: number;
  /** Cards matching the search, oldest first: the shown page only (D-317). */
  cards: DeckCardRow[];
  /** "Showing 100 of 1,014 cards" while not every match is shown. */
  shownLabel: string | null;
  /** How many cards "Show more" adds (0: no button). */
  more: number;
  search: string;
  canStudy: boolean;
  /** M7 (§7.7): "Study: All units / Unit 1 …" (empty: the deck has no units). */
  units: { number: number; label: string; toStudy: number }[];
  /** The chosen unit, or null for all units. */
  unit: number | null;
  /** Where "Study deck" goes (with the chosen unit). */
  studyHref: string;
  /** M7 (§7.6): a newer catalog version is out. */
  update: {
    from: number;
    to: number;
    /** "12 changed, 5 new, 2 removed"; null until known (needs the network). */
    summary: DeckUpdatePlan['summary'] | null;
    offline: boolean;
    updating: boolean;
  } | null;
  setUnit: (unit: number | null) => void;
  applyUpdate: () => void;

  renameOpen: boolean;
  renameValue: string;
  renameError: string | null;
  deleteOpen: boolean;

  setSearch: (q: string) => void;
  showMore: () => void;
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
  return `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`;
}

export function useDeck(deckId: string): DeckViewModel {
  const { ctx, browserTimeZone, pendingDeletes, catalog } = useServices();
  const [unit, setUnit] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const [plan, setPlan] = useState<{
    key: string;
    summary: DeckUpdatePlan['summary'] | null;
    offline: boolean;
  } | null>(null);
  const updateQuery = useQuery(() => availableUpdate(ctx, deckId), [ctx, deckId]);
  const available = updateQuery.status === 'ready' ? updateQuery.data : null;
  const updateKey = available
    ? `${deckId}:${String(available.from)}:${String(available.to)}`
    : null;

  // The banner counts come from the real plan (edited cards count as changed), which
  // needs both versions from the server.
  useEffect(() => {
    if (updateKey === null) return;
    let cancelled = false;
    planCatalogUpdate(ctx, catalog, deckId).then(
      (planned) => {
        if (!cancelled)
          setPlan({ key: updateKey, summary: planned?.plan.summary ?? null, offline: false });
      },
      (error: unknown) => {
        if (!cancelled) {
          setPlan({ key: updateKey, summary: null, offline: error instanceof CatalogOfflineError });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, catalog, deckId, updateKey]);
  const toasts = useToasts();
  const navigate = useNavigate();
  const [search, setSearchText] = useState('');
  const [limit, setLimit] = useState(CARD_PAGE_SIZE);
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
    setSearch: (q: string) => {
      setSearchText(q);
      setLimit(CARD_PAGE_SIZE);
    },
    showMore: () => {
      setLimit((n) => n + CARD_PAGE_SIZE);
    },
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
    setUnit: (next: number | null) => {
      setUnit(next);
    },
    applyUpdate: () => {
      if (updating) return;
      setUpdating(true);
      updateCatalogDeck(ctx, catalog, deckId)
        .then((applied) => {
          toasts.show({ message: updateToast(applied) });
        })
        .catch((error: unknown) => {
          toasts.show({
            message:
              error instanceof CatalogOfflineError
                ? 'Connect to the internet to update this deck.'
                : 'Couldn’t update the deck. Please try again.',
          });
        })
        .finally(() => {
          setUpdating(false);
        });
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
    isFromStore: false,
    cardCount: 0,
    cards: [],
    shownLabel: null,
    more: 0,
    search,
    canStudy: false,
    units: [],
    unit,
    studyHref: `/study?deck=${deckId}`,
    update: null,
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
  const page = pageOfCards(searchCards(visible, search), limit);
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
    isFromStore: deck.source === 'catalog',
    cardCount: visible.length,
    cards: page.visible.map((c) => {
      const dueLabel = cardDueLabel(c.state, now, timeZone, rolloverHour);
      return { id: c.id, front: c.front, dueLabel, isDue: dueLabel === 'Due today' };
    }),
    shownLabel: page.shownLabel,
    more: page.more,
    canStudy:
      unit === null
        ? dueToday + counts.new > 0
        : (data.units.find((u) => u.number === unit)?.toStudy ?? 0) > 0,
    units: data.units.map((u) => ({
      number: u.number,
      label:
        u.title === null ? `Unit ${String(u.number)}` : `Unit ${String(u.number)} · ${u.title}`,
      toStudy: u.toStudy,
    })),
    studyHref:
      unit === null ? `/study?deck=${deckId}` : `/study?deck=${deckId}&unit=${String(unit)}`,
    update: available
      ? {
          from: available.from,
          to: available.to,
          summary: plan?.key === updateKey ? plan.summary : null,
          offline: plan?.key === updateKey ? plan.offline : false,
          updating,
        }
      : null,
  };
}

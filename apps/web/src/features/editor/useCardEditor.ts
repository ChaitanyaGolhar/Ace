import { useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { createCard, updateCard } from '../../services/cards';
import { UserInputError } from '../../services/errors';

export type CardEditorTarget = { mode: 'new'; deckId: string } | { mode: 'edit'; cardId: string };

export interface CardEditorViewModel {
  status: 'loading' | 'error' | 'notFound' | 'ready';
  mode: 'new' | 'edit';
  /** Decks for the picker (live decks, by name). */
  decks: { id: string; name: string }[];
  deckId: string | null;
  front: string;
  back: string;
  frontError: string | null;
  backError: string | null;
  formError: string | null;
  saving: boolean;
  /** Live status: "3 cards added to DBMS Basics" (new mode). */
  addedStatus: string;
  /** Bumped after "Save & add another", so the view can refocus the question field. */
  focusFrontToken: number;
  /** There is typed text that would be lost by leaving. */
  dirty: boolean;
  /** Leaving was attempted with unsaved text: ask first. */
  confirmLeave: boolean;
  setDeckId: (id: string) => void;
  setFront: (v: string) => void;
  setBack: (v: string) => void;
  /** New: save and clear for the next card (Ctrl/Cmd+Enter). Edit: save and go back. */
  saveAndAddAnother: () => void;
  saveAndClose: () => void;
  cancel: () => void;
  keepEditing: () => void;
  discardAndLeave: () => void;
}

export function useCardEditor(target: CardEditorTarget): CardEditorViewModel {
  const { ctx } = useServices();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'notFound' | 'ready'>(
    target.mode === 'new' ? 'ready' : 'loading',
  );
  const [deckId, setDeckId] = useState<string | null>(target.mode === 'new' ? target.deckId : null);
  const [original, setOriginal] = useState({ front: '', back: '' });
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [frontError, setFrontError] = useState<string | null>(null);
  const [backError, setBackError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<{ deckId: string | null; count: number }>({
    deckId: null,
    count: 0,
  });
  const [focusFrontToken, setFocusFrontToken] = useState(0);
  // Set right before navigating away after a save, so the unsaved-changes guard lets go.
  const leaving = useRef(false);

  const decksQuery = useQuery(
    async () =>
      (await ctx.db.decks.toArray())
        .filter((d) => d.deletedAt === null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map((d) => ({ id: d.id, name: d.name })),
    [ctx],
  );
  const decks = decksQuery.status === 'ready' ? decksQuery.data : [];

  const editId = target.mode === 'edit' ? target.cardId : null;
  useEffect(() => {
    if (editId === null) return;
    let cancelled = false;
    ctx.db.cards.get(editId).then(
      (card) => {
        if (cancelled) return;
        if (!card || card.deletedAt !== null) {
          setLoadState('notFound');
          return;
        }
        setFront(card.front);
        setBack(card.back);
        setOriginal({ front: card.front, back: card.back });
        setDeckId(card.deckId);
        setLoadState('ready');
      },
      () => {
        if (!cancelled) setLoadState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, editId]);

  const dirty =
    target.mode === 'new'
      ? front.trim() !== '' || back.trim() !== ''
      : front !== original.front || back !== original.back;

  const blocker = useBlocker(() => dirty && !leaving.current);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const showError = (e: unknown) => {
    if (e instanceof UserInputError) {
      if (e.field === 'front') setFrontError(e.message);
      else if (e.field === 'back') setBackError(e.message);
      else setFormError(e.message);
    } else {
      setFormError('Couldn’t save the card. Please try again.');
    }
  };

  const leaveToDeck = (id: string | null) => {
    leaving.current = true;
    void navigate(id ? `/decks/${id}` : '/decks');
  };

  const save = (thenClose: boolean) => {
    if (saving || loadState !== 'ready') return;
    if (target.mode === 'new') {
      if (!deckId) {
        setFormError('Choose a deck first.');
        return;
      }
      // "Save and close" with an empty form just closes.
      if (thenClose && !dirty) {
        leaveToDeck(deckId);
        return;
      }
      setSaving(true);
      createCard(ctx, deckId, front, back)
        .then(() => {
          if (thenClose) {
            leaveToDeck(deckId);
            return;
          }
          setFront('');
          setBack('');
          setAdded((a) => ({ deckId, count: a.deckId === deckId ? a.count + 1 : 1 }));
          setFocusFrontToken((n) => n + 1);
        })
        .catch(showError)
        .finally(() => {
          setSaving(false);
        });
    } else {
      setSaving(true);
      updateCard(ctx, target.cardId, { front, back })
        .then(() => {
          leaveToDeck(deckId);
        })
        .catch(showError)
        .finally(() => {
          setSaving(false);
        });
    }
  };

  const addedDeckName = decks.find((d) => d.id === added.deckId)?.name ?? '';
  const addedStatus =
    added.count > 0
      ? `${String(added.count)} ${added.count === 1 ? 'card' : 'cards'} added to ${addedDeckName}`
      : '';

  const status =
    loadState === 'ready' && decksQuery.status === 'loading'
      ? 'loading'
      : decksQuery.status === 'error'
        ? 'error'
        : loadState;

  return {
    status,
    mode: target.mode,
    decks,
    deckId,
    front,
    back,
    frontError,
    backError,
    formError,
    saving,
    addedStatus,
    focusFrontToken,
    dirty,
    confirmLeave: blocker.state === 'blocked',
    setDeckId: (id) => {
      setDeckId(id);
      setFormError(null);
    },
    setFront: (v) => {
      setFront(v);
      setFrontError(null);
      setFormError(null);
    },
    setBack: (v) => {
      setBack(v);
      setBackError(null);
      setFormError(null);
    },
    saveAndAddAnother: () => {
      save(target.mode === 'edit');
    },
    saveAndClose: () => {
      save(true);
    },
    cancel: () => {
      void navigate(deckId ? `/decks/${deckId}` : '/decks');
    },
    keepEditing: () => {
      if (blocker.state === 'blocked') blocker.reset();
    },
    discardAndLeave: () => {
      if (blocker.state === 'blocked') blocker.proceed();
    },
  };
}

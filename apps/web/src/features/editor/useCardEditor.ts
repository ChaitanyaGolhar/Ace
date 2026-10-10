import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { createCard, updateCard } from '../../services/cards';
import { UserInputError } from '../../services/errors';

export type CardEditorTarget = { mode: 'new'; deckId: string } | { mode: 'edit'; cardId: string };

export interface CardEditorViewModel {
  status: 'loading' | 'error' | 'notFound' | 'ready';
  mode: 'new' | 'edit';
  deckId: string | null;
  front: string;
  back: string;
  frontError: string | null;
  backError: string | null;
  formError: string | null;
  saving: boolean;
  /** Cards added since this screen opened (new mode), for the "Card added" message. */
  addedCount: number;
  /** Bumped after "Save & add another", so the view can refocus the front field. */
  focusFrontToken: number;
  setFront: (v: string) => void;
  setBack: (v: string) => void;
  /** New mode: save and clear for the next card. Edit mode: save and go back. (Ctrl/Cmd+Enter) */
  saveAndContinue: () => void;
  /** Leave without saving. */
  done: () => void;
}

export function useCardEditor(target: CardEditorTarget): CardEditorViewModel {
  const { ctx } = useServices();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CardEditorViewModel['status']>(
    target.mode === 'new' ? 'ready' : 'loading',
  );
  const [deckId, setDeckId] = useState<string | null>(target.mode === 'new' ? target.deckId : null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [frontError, setFrontError] = useState<string | null>(null);
  const [backError, setBackError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [focusFrontToken, setFocusFrontToken] = useState(0);

  const editId = target.mode === 'edit' ? target.cardId : null;
  useEffect(() => {
    if (editId === null) return;
    let cancelled = false;
    ctx.db.cards.get(editId).then(
      (card) => {
        if (cancelled) return;
        if (!card || card.deletedAt !== null) {
          setStatus('notFound');
          return;
        }
        setFront(card.front);
        setBack(card.back);
        setDeckId(card.deckId);
        setStatus('ready');
      },
      () => {
        if (!cancelled) setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, editId]);

  const showError = (e: unknown) => {
    if (e instanceof UserInputError) {
      if (e.field === 'front') setFrontError(e.message);
      else if (e.field === 'back') setBackError(e.message);
      else setFormError(e.message);
    } else {
      setFormError('Couldn’t save the card. Please try again.');
    }
  };

  const backToDeck = () => {
    void navigate(deckId ? `/decks/${deckId}` : '/');
  };

  return {
    status,
    mode: target.mode,
    deckId,
    front,
    back,
    frontError,
    backError,
    formError,
    saving,
    addedCount,
    focusFrontToken,
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
    saveAndContinue: () => {
      if (saving || status !== 'ready') return;
      setSaving(true);
      const save =
        target.mode === 'new'
          ? createCard(ctx, target.deckId, front, back).then(() => {
              setFront('');
              setBack('');
              setAddedCount((n) => n + 1);
              setFocusFrontToken((n) => n + 1);
            })
          : updateCard(ctx, target.cardId, { front, back }).then(backToDeck);
      save.catch(showError).finally(() => {
        setSaving(false);
      });
    },
    done: backToDeck,
  };
}

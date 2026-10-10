import type { CardType } from '@recall/core';
import { useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { createTypedCard, updateCardContent } from '../../services/cards';
import { UserInputError } from '../../services/errors';
import {
  changeType,
  draftFromContent,
  emptyDraft,
  lostOnTypeChange,
  TYPE_LABELS,
  validateDraft,
  type Draft,
} from './draft';

export type CardEditorTarget = { mode: 'new'; deckId: string } | { mode: 'edit'; cardId: string };

/** A pending type change that would clear filled fields: ask first (§6.5). */
export interface TypeChangePrompt {
  to: CardType;
  title: string;
  /** "The options and explanation will be cleared." */
  message: string;
}

export interface CardEditorViewModel {
  status: 'loading' | 'error' | 'notFound' | 'ready';
  mode: 'new' | 'edit';
  /** Decks for the picker (live decks, by name). */
  decks: { id: string; name: string }[];
  deckId: string | null;
  draft: Draft;
  /** Field → message, for fields the user has touched (or all, after a save attempt). */
  errors: Record<string, string>;
  /** The whole card is valid: Save is enabled. */
  valid: boolean;
  formError: string | null;
  saving: boolean;
  /** Live status: "3 cards added to DBMS Basics" (new mode). */
  addedStatus: string;
  /** Bumped after "Save & add another", so the view can refocus the first field. */
  focusFrontToken: number;
  /** There is typed text that would be lost by leaving. */
  dirty: boolean;
  /** Leaving was attempted with unsaved text: ask first. */
  confirmLeave: boolean;
  typeChange: TypeChangePrompt | null;
  setDeckId: (id: string) => void;
  /** Changes the type, or asks first if filled fields would be cleared. */
  setType: (type: CardType) => void;
  confirmTypeChange: () => void;
  cancelTypeChange: () => void;
  update: (patch: Partial<Draft>) => void;
  /** Marks a field as touched (on blur), so its error shows. */
  touch: (field: string) => void;
  addOption: () => void;
  removeOption: (index: number) => void;
  addKeyPoint: () => void;
  removeKeyPoint: (index: number) => void;
  moveKeyPoint: (index: number, by: -1 | 1) => void;
  addAccepted: () => void;
  removeAccepted: (index: number) => void;
  /** New: save and clear for the next card (Ctrl/Cmd+Enter). Edit: save and go back. */
  saveAndAddAnother: () => void;
  saveAndClose: () => void;
  cancel: () => void;
  keepEditing: () => void;
  discardAndLeave: () => void;
}

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** Field keys an edit touches, so errors appear field by field as the user works. */
function fieldsOf(patch: Partial<Draft>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v)) v.forEach((_, i) => keys.push(`${k}.${String(i)}`));
    keys.push(k);
  }
  return keys;
}

export function useCardEditor(target: CardEditorTarget): CardEditorViewModel {
  const { ctx } = useServices();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'notFound' | 'ready'>(
    target.mode === 'new' ? 'ready' : 'loading',
  );
  const [deckId, setDeckId] = useState<string | null>(target.mode === 'new' ? target.deckId : null);
  const [original, setOriginal] = useState<Draft>(emptyDraft());
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [typeChange, setTypeChange] = useState<TypeChangePrompt | null>(null);
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
        const loaded = draftFromContent(card.content);
        setDraft(loaded);
        setOriginal(loaded);
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

  const validation = validateDraft(draft);
  const errors = Object.fromEntries(
    Object.entries(validation.errors).filter(([field]) => showAll || touched.has(field)),
  );
  const dirty =
    target.mode === 'new' ? !same(draft, emptyDraft(draft.type)) : !same(draft, original);

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
    if (e instanceof UserInputError) setFormError(e.message);
    else setFormError('Couldn’t save the card. Please try again.');
  };

  const leaveToDeck = (id: string | null) => {
    leaving.current = true;
    void navigate(id ? `/decks/${id}` : '/decks');
  };

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setTouched((t) => new Set([...t, ...fieldsOf(patch)]));
    setFormError(null);
  };

  const save = (thenClose: boolean) => {
    if (saving || loadState !== 'ready') return;
    if (target.mode === 'new' && !deckId) {
      setFormError('Choose a deck first.');
      return;
    }
    // "Save and close" with an empty form just closes.
    if (target.mode === 'new' && thenClose && !dirty) {
      leaveToDeck(deckId);
      return;
    }
    if (validation.content === null) {
      setShowAll(true);
      return;
    }
    const content = validation.content;
    setSaving(true);
    const write =
      target.mode === 'new'
        ? createTypedCard(ctx, deckId ?? '', content).then(() => {
            if (thenClose) {
              leaveToDeck(deckId);
              return;
            }
            // Ready for the next card of the same type.
            setDraft(emptyDraft(draft.type));
            setTouched(new Set());
            setShowAll(false);
            setAdded((a) => ({ deckId, count: a.deckId === deckId ? a.count + 1 : 1 }));
            setFocusFrontToken((n) => n + 1);
          })
        : updateCardContent(ctx, target.cardId, content).then(() => {
            leaveToDeck(deckId);
          });
    write.catch(showError).finally(() => {
      setSaving(false);
    });
  };

  const applyType = (to: CardType) => {
    setDraft((d) => changeType(d, to));
    setTouched(new Set());
    setShowAll(false);
    setTypeChange(null);
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
    draft,
    errors,
    valid: validation.content !== null,
    formError,
    saving,
    addedStatus,
    focusFrontToken,
    dirty,
    confirmLeave: blocker.state === 'blocked',
    typeChange,
    setDeckId: (id) => {
      setDeckId(id);
      setFormError(null);
    },
    setType: (to) => {
      if (to === draft.type) return;
      const lost = lostOnTypeChange(draft, to);
      if (lost.length === 0) {
        applyType(to);
        return;
      }
      const list =
        lost.length === 1 ? lost[0] : `${lost.slice(0, -1).join(', ')} and ${lost.at(-1) ?? ''}`;
      setTypeChange({
        to,
        title: `Change to ${TYPE_LABELS[to]}?`,
        message: `${list ?? ''} will be cleared.`,
      });
    },
    confirmTypeChange: () => {
      if (typeChange) applyType(typeChange.to);
    },
    cancelTypeChange: () => {
      setTypeChange(null);
    },
    update,
    touch: (field) => {
      setTouched((t) => new Set([...t, field]));
    },
    addOption: () => {
      if (draft.options.length < 6) update({ options: [...draft.options, ''] });
    },
    removeOption: (index) => {
      if (draft.options.length <= 2) return;
      const options = draft.options.filter((_, i) => i !== index);
      const correct =
        draft.correct === null || draft.correct === index
          ? null
          : draft.correct > index
            ? draft.correct - 1
            : draft.correct;
      update({ options, correct });
    },
    addKeyPoint: () => {
      if (draft.keyPoints.length < 12) update({ keyPoints: [...draft.keyPoints, ''] });
    },
    removeKeyPoint: (index) => {
      if (draft.keyPoints.length > 1) {
        update({ keyPoints: draft.keyPoints.filter((_, i) => i !== index) });
      }
    },
    moveKeyPoint: (index, by) => {
      const to = index + by;
      if (to < 0 || to >= draft.keyPoints.length) return;
      const keyPoints = [...draft.keyPoints];
      const [moved] = keyPoints.splice(index, 1);
      keyPoints.splice(to, 0, moved ?? '');
      update({ keyPoints });
    },
    addAccepted: () => {
      if (draft.accepted.length < 10) update({ accepted: [...draft.accepted, ''] });
    },
    removeAccepted: (index) => {
      update({ accepted: draft.accepted.filter((_, i) => i !== index) });
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

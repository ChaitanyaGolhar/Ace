import type { Rating } from '@recall/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import type { Session } from '../../db/meta';
import { formatInterval } from '../../services/format';
import { loadQueue, nextCard, remainingCount } from '../../services/queue';
import { loadReviewCard, rateCard, undoLastReview } from '../../services/review';
import { sessionSummary, startSession } from '../../services/session';

export const RATING_LABELS = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as const;

export interface RatingOption {
  rating: Rating;
  label: (typeof RATING_LABELS)[Rating];
  /** Next interval if chosen, e.g. "10m", "3d". */
  interval: string;
  /** Keyboard shortcut. */
  key: '1' | '2' | '3' | '4';
}

export interface ReviewViewModel {
  status: 'loading' | 'error' | 'empty' | 'studying' | 'complete';
  card: { id: string; front: string; back: string } | null;
  revealed: boolean;
  /** One-line hint, shown only on the very first card the user ever studies. */
  showHint: boolean;
  ratings: RatingOption[];
  /** Cards left in this session. */
  remaining: number;
  /** Reviews done in this session. */
  reviewed: number;
  canUndo: boolean;
  /** A rating or undo is being saved. */
  busy: boolean;
  /** Text for the screen-reader live region ("Answer shown"). */
  announcement: string;
  actionError: string | null;
  /** Where to go when the session is complete. */
  completeHref: string;
  showAnswer: () => void;
  rate: (rating: Rating) => void;
  undo: () => void;
}

/** How often to re-check the queue while idle, so learning cards appear when due. */
const TICK_MS = 15_000;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * The review session. Which card comes next always comes from the queue (core
 * buildQueue), so a reload simply rebuilds the session; the only stored session state
 * is its start time (for "reviewed so far" and undo).
 */
export function useReview(deckId: string | null): ReviewViewModel {
  const { ctx, browserTimeZone } = useServices();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [tick, setTick] = useState(0);
  // The card on screen stays put until it is rated, even if the queue order changes
  // underneath (e.g. a learning card becomes due while you are reading a new card).
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // After a rating or undo is saved, wait for a queue snapshot that includes it before
  // moving on. Otherwise the stale snapshot would show the card just rated again, and
  // it could be rated twice.
  const [awaiting, setAwaiting] = useState<{ fingerprint: string; pin: string | null } | null>(
    null,
  );
  const shownAt = useRef(ctx.now());

  useEffect(() => {
    let cancelled = false;
    startSession(ctx, deckId, browserTimeZone).then(
      (s) => {
        if (!cancelled) setSession(s);
      },
      () => {
        if (!cancelled) setSessionError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, deckId, browserTimeZone]);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  const queueQuery = useQuery(async () => {
    if (!session) return null;
    const queue = await loadQueue(ctx, {
      browserTimeZone,
      ...(deckId === null ? {} : { deckId }),
    });
    const summary = await sessionSummary(ctx, session);
    const logCount = await ctx.db.reviewLogs.count();
    const voidedCount = await ctx.db.reviewLogs.filter((l) => l.voidedAt !== null).count();
    // Changes on every rating (new log) and every undo (newly voided log). Used to tell
    // whether this snapshot already includes our last write.
    const logsFingerprint = `${String(logCount)}:${String(voidedCount)}`;
    return { queue, summary, everReviewed: logCount > 0, logsFingerprint };
  }, [ctx, session, deckId, browserTimeZone, tick]);

  const queueData = queueQuery.status === 'ready' ? queueQuery.data : null;
  let currentId: string | null = null;
  if (queueData) {
    const { queue } = queueData;
    const candidates = [...queue.due, ...queue.newCards];
    if (queue.learnAheadNext) candidates.push(queue.learnAheadNext.cardId);
    currentId =
      pinnedId !== null && candidates.includes(pinnedId)
        ? pinnedId
        : (nextCard(queue)?.cardId ?? null);
  }

  // Pin whatever is first shown. A pin is only replaced by rating (which clears it) or
  // undo (which pins the undone card). Never overwrite an existing pin here: right after
  // an undo the queue snapshot may be stale and not contain the undone card yet.
  useEffect(() => {
    if (pinnedId === null && currentId !== null) setPinnedId(currentId);
  }, [currentId, pinnedId]);

  // A different card is on screen: hide the answer and restart its timer.
  useEffect(() => {
    setRevealed(false);
    shownAt.current = ctx.now();
  }, [ctx, currentId]);

  useEffect(() => {
    if (awaiting && queueData && queueData.logsFingerprint !== awaiting.fingerprint) {
      setPinnedId(awaiting.pin);
      setRevealed(false);
      shownAt.current = ctx.now();
      setAwaiting(null);
      setBusy(false);
    }
  }, [ctx, awaiting, queueData]);

  const cardQuery = useQuery(
    () => (currentId === null ? Promise.resolve(null) : loadReviewCard(ctx, currentId)),
    [ctx, currentId, tick],
  );
  const reviewCard = cardQuery.status === 'ready' ? cardQuery.data : null;

  const showAnswer = useCallback(() => {
    setRevealed(true);
  }, []);

  const rate = useCallback(
    (rating: Rating) => {
      if (!revealed || busy || currentId === null || !queueData) return;
      const fingerprint = queueData.logsFingerprint;
      setBusy(true);
      setActionError(null);
      rateCard(ctx, { cardId: currentId, rating, durationMs: ctx.now() - shownAt.current })
        .then(() => {
          // Busy until the queue reflects this rating; then the next card is picked.
          setAwaiting({ fingerprint, pin: null });
        })
        .catch(() => {
          setActionError('Couldn’t save that rating. Please try again.');
          setBusy(false);
        });
    },
    [ctx, revealed, busy, currentId, queueData],
  );

  const reviewed = queueData?.summary.reviewed ?? 0;
  const canUndo = reviewed > 0 && !busy;

  const undo = useCallback(() => {
    if (!session || !canUndo || !queueData) return;
    const fingerprint = queueData.logsFingerprint;
    setBusy(true);
    setActionError(null);
    undoLastReview(ctx, session.startedAt)
      .then((undone) => {
        if (!undone) {
          setBusy(false);
          return;
        }
        // Once the queue reflects the undo, bring the undone card back, answer hidden.
        setAwaiting({ fingerprint, pin: undone.cardId });
      })
      .catch(() => {
        setActionError('Couldn’t undo. Please try again.');
        setBusy(false);
      });
  }, [ctx, session, canUndo, queueData]);

  // Keyboard: Space shows the answer, 1–4 rate, Z undoes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      // Space on a focused button already activates that button.
      if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
      if (event.key === ' ' && !revealed && reviewCard) {
        event.preventDefault();
        showAnswer();
      } else if (['1', '2', '3', '4'].includes(event.key) && revealed) {
        event.preventDefault();
        rate(Number(event.key) as Rating);
      } else if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [revealed, reviewCard, showAnswer, rate, undo]);

  const completeHref = deckId === null ? '/study/complete' : `/study/complete?deck=${deckId}`;
  const base = {
    card: null,
    revealed: false,
    showHint: false,
    ratings: [],
    remaining: 0,
    reviewed,
    canUndo,
    busy,
    announcement: '',
    actionError,
    completeHref,
    showAnswer,
    rate,
    undo,
  };

  if (sessionError || queueQuery.status === 'error' || cardQuery.status === 'error') {
    return { ...base, status: 'error' };
  }
  if (!queueData) return { ...base, status: 'loading' };
  if (currentId === null) return { ...base, status: reviewed > 0 ? 'complete' : 'empty' };
  if (!reviewCard) return { ...base, status: 'loading' };

  const ratings = ([1, 2, 3, 4] as const).map((r) => ({
    rating: r,
    label: RATING_LABELS[r],
    interval: formatInterval(reviewCard.preview[r]),
    key: String(r) as RatingOption['key'],
  }));

  return {
    ...base,
    status: 'studying',
    card: reviewCard.card,
    revealed,
    showHint: !queueData.everReviewed && !revealed,
    ratings,
    remaining: remainingCount(queueData.queue),
    announcement: revealed ? 'Answer shown' : '',
  };
}

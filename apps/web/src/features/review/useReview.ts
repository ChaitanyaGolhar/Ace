import type { CardContent, Rating } from '@recall/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import type { Session } from '../../db/meta';
import { completionSentence, nextDueValue } from '../../services/completion';
import { formatInterval } from '../../services/format';
import { loadNextDue } from '../../services/overview';
import { loadQueue, nextCard, remainingCount } from '../../services/queue';
import { lastSessionRating, loadReviewCard, rateCard, undoLastReview } from '../../services/review';
import { finishSession, sessionSummary, startSession } from '../../services/session';
import { isPlainShortcut } from '../shell/keyboard';
import {
  answerReducer,
  initialAnswer,
  outcomeOf,
  ratingStage,
  shortcut,
  type AnswerAction,
  type AnswerState,
  type RatingStage,
} from './answer';

export const RATING_LABELS = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as const;

export interface RatingOption {
  rating: Rating;
  label: (typeof RATING_LABELS)[Rating];
  /** Next interval if chosen, from core previewIntervals(): "10m", "3d"… */
  interval: string;
  /** Keyboard shortcut (shown on desktop). */
  key: '1' | '2' | '3' | '4';
}

export interface ReviewViewModel {
  status: 'loading' | 'error' | 'empty' | 'studying' | 'complete';
  /** Deck being studied, or "All decks". */
  deckName: string;
  /** "3 of 12": this card's position in the session. */
  position: { current: number; total: number };
  /** 0–1, for the thin progress bar. */
  progress: number;
  card: { id: string; front: string; back: string; content: CardContent } | null;
  /** M6: where the user is with this card (choice, typed check, ticks…). */
  answer: AnswerState | null;
  /** M6: what the footer offers: nothing yet, a single Continue (= Again), or ratings. */
  stage: RatingStage;
  /** Card type tag. */
  kind: 'New' | 'Review';
  revealed: boolean;
  /** One-line hint, only on the very first card the user ever studies. */
  showHint: boolean;
  ratings: RatingOption[];
  /** Undo pill: "Undo · previous card was Good". Null when there is nothing to undo. */
  undoLabel: string | null;
  busy: boolean;
  /** Screen-reader live region: "Answer shown". */
  announcement: string;
  actionError: string | null;
  /** Completion: "You reviewed 4 cards in about 3 minutes." */
  completionText: string;
  /** Completion: "9 tomorrow". */
  nextDueText: string;
  showAnswer: () => void;
  /** M6: an action on the card on screen (select an option, type, check, tick…). */
  act: (action: AnswerAction) => void;
  rate: (rating: Rating) => void;
  undo: () => void;
  /** ✕ / "Back to home": finish the session and go home. */
  finish: () => void;
}

/** How often to re-check the queue while idle, so learning cards appear when due. */
const TICK_MS = 15_000;

/**
 * The review session. Which card comes next always comes from the queue (core
 * buildQueue), so a reload simply rebuilds the session; the only stored session state
 * is its start time (for "reviewed so far" and undo).
 */
export function useReview(deckId: string | null): ReviewViewModel {
  const { ctx, browserTimeZone, sync } = useServices();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [tick, setTick] = useState(0);
  // The card on screen stays put until it is rated, even if the queue order changes
  // underneath (e.g. a learning card becomes due while you are reading a new card).
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // Answer state per card on screen. The state a card was rated in is kept, so undo can
  // bring the card back answered and it can be re-rated (§6.3).
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const rated = useRef<Record<string, AnswerState>>({});
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
    // Undo only voids this session's logs, so counting voided logs since the session
    // started is enough, and it doesn't scan a big collection's whole history.
    const voidedCount = await ctx.db.reviewLogs
      .where('reviewedAt')
      .aboveOrEqual(session.startedAt)
      .filter((l) => l.voidedAt !== null)
      .count();
    const deckName =
      deckId === null ? 'All decks' : ((await ctx.db.decks.get(deckId))?.name ?? 'Deck');
    const lastRating = await lastSessionRating(ctx, session.startedAt);
    const nextDue = nextCard(queue) ? null : await loadNextDue(ctx, { browserTimeZone });
    return {
      queue,
      summary,
      everReviewed: logCount > 0,
      // Changes on every rating (new log) and every undo (newly voided log). Used to tell
      // whether this snapshot already includes our last write.
      logsFingerprint: `${String(logCount)}:${String(voidedCount)}`,
      deckName,
      lastRating,
      nextDue,
    };
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

  // A different card is on screen: restart its timer.
  useEffect(() => {
    shownAt.current = ctx.now();
  }, [ctx, currentId]);

  useEffect(() => {
    if (awaiting && queueData && queueData.logsFingerprint !== awaiting.fingerprint) {
      setPinnedId(awaiting.pin);
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
  const content = reviewCard?.card.content ?? null;
  const answer: AnswerState | null =
    content === null || currentId === null ? null : (answers[currentId] ?? initialAnswer(content));
  const stage: RatingStage =
    content !== null && answer !== null ? ratingStage(content, answer) : { buttons: 'none' };
  const revealed = stage.buttons !== 'none';

  const act = useCallback(
    (action: AnswerAction) => {
      if (content === null || currentId === null || busy) return;
      setAnswers((all) => ({
        ...all,
        [currentId]: answerReducer(content, all[currentId] ?? initialAnswer(content), action),
      }));
    },
    [content, currentId, busy],
  );

  const showAnswer = useCallback(() => {
    act({ kind: 'reveal' });
  }, [act]);

  const rate = useCallback(
    (rating: Rating) => {
      if (busy || currentId === null || !queueData || content === null || answer === null) return;
      if (stage.buttons === 'none' || !stage.ratings.includes(rating)) return;
      const fingerprint = queueData.logsFingerprint;
      const outcome = outcomeOf(content, answer);
      setBusy(true);
      setActionError(null);
      rateCard(ctx, {
        cardId: currentId,
        rating,
        durationMs: ctx.now() - shownAt.current,
        outcome,
      })
        .then(() => {
          // Remember how it was answered (for undo); next time it's shown it starts fresh.
          rated.current[currentId] = answer;
          setAnswers((all) => {
            const { [currentId]: _done, ...rest } = all;
            return rest;
          });
          // Busy until the queue reflects this rating; then the next card is picked.
          setAwaiting({ fingerprint, pin: null });
        })
        .catch(() => {
          setActionError('Couldn’t save that rating. Please try again.');
          setBusy(false);
        });
    },
    [ctx, busy, currentId, queueData, content, answer, stage],
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
        // Once the queue reflects the undo, bring the undone card back as it was answered,
        // so it can be rated again (§6.3).
        const before = rated.current[undone.cardId];
        if (before) setAnswers((all) => ({ ...all, [undone.cardId]: before }));
        setAwaiting({ fingerprint, pin: undone.cardId });
      })
      .catch(() => {
        setActionError('Couldn’t undo. Please try again.');
        setBusy(false);
      });
  }, [ctx, session, canUndo, queueData]);

  const finish = useCallback(() => {
    // Records session_completed / session_abandoned (M4), then syncs in the background:
    // the end of a study session is a sync trigger (§8.4).
    const outcome = {
      reviewed: queueData?.summary.reviewed ?? 0,
      remaining: queueData ? remainingCount(queueData.queue) : 0,
      timeSpentMs: queueData?.summary.timeSpentMs ?? 0,
    };
    void finishSession(ctx, outcome)
      .then(() => sync.requestSync())
      .finally(() => navigate('/'));
  }, [ctx, navigate, sync, queueData]);

  // Keyboard (§6.3): per type (answer.ts shortcut), plus Z to undo. Never while typing;
  // a text field handles its own Enter (check).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPlainShortcut(event)) return;
      // Space or Enter on a focused button already activates that button.
      if (
        (event.key === ' ' || event.key === 'Enter') &&
        event.target instanceof HTMLButtonElement
      ) {
        return;
      }
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        undo();
        return;
      }
      if (content === null || answer === null) return;
      const hit = shortcut(content, answer, event.key);
      if (hit === null) return;
      event.preventDefault();
      if ('rate' in hit) rate(hit.rate);
      else act(hit.action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [content, answer, act, rate, undo]);

  const remaining = queueData ? remainingCount(queueData.queue) : 0;
  const total = reviewed + remaining;
  const base = {
    deckName: queueData?.deckName ?? '',
    position: { current: Math.min(reviewed + 1, Math.max(total, 1)), total },
    progress: total === 0 ? 0 : reviewed / total,
    card: null,
    answer: null,
    stage: { buttons: 'none' } as RatingStage,
    kind: 'New' as const,
    revealed: false,
    showHint: false,
    ratings: [],
    undoLabel:
      canUndo && queueData?.lastRating
        ? `Undo · previous card was ${RATING_LABELS[queueData.lastRating]}`
        : null,
    busy,
    announcement: '',
    actionError,
    completionText: completionSentence(reviewed, queueData?.summary.timeSpentMs ?? 0),
    nextDueText: queueData?.nextDue ? nextDueValue(queueData.nextDue) : '',
    showAnswer,
    act,
    rate,
    undo,
    finish,
  };

  if (sessionError || queueQuery.status === 'error' || cardQuery.status === 'error') {
    return { ...base, status: 'error' };
  }
  if (!queueData) return { ...base, status: 'loading' };
  if (currentId === null) {
    return {
      ...base,
      status: reviewed > 0 ? 'complete' : 'empty',
      position: { current: total, total },
      progress: total === 0 ? 0 : 1,
    };
  }
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
    answer,
    stage,
    kind: reviewCard.state.state === 'new' ? 'New' : 'Review',
    revealed,
    showHint: !queueData.everReviewed && !revealed,
    ratings,
    announcement: revealed ? 'Answer shown' : '',
  };
}

import type { CardContent, Rating } from '@recall/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import type { Session } from '../../db/meta';
import {
  completionSentence,
  farOffLine,
  nextDueLine,
  rememberedLine,
} from '../../services/completion';
import { formatInterval } from '../../services/format';
import { loadNextDue } from '../../services/overview';
import { capQueue, loadQueue, nextCard, remainingCount } from '../../services/queue';
import { lastSessionRating, loadReviewCard, rateCard, undoLastReview } from '../../services/review';
import { finishSession, sessionRecap, sessionSummary, startSession } from '../../services/session';
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
  /** Feel pass: changes whenever a card (or the same card, again) comes on screen. */
  cardKey: string;
  /** Feel pass: the card on screen was rated and is on its way out. */
  leaving: boolean;
  /** Feel pass: the rating being saved (its button shows pressed), or null. */
  pressedRating: Rating | null;
  /** Screen-reader live region: "Answer shown". */
  announcement: string;
  actionError: string | null;
  /** Completion: "You reviewed 4 cards in about 3 minutes." */
  completionText: string;
  /** Completion: "Next: 9 due tomorrow". */
  nextDueText: string;
  /** Completion: "Remembered 7 of 8". */
  rememberedText: string;
  /** Completion: "3 cards won’t come back for 2+ weeks.", only when true. */
  farOffText: string | null;
  /** Completion of a capped session with due cards left: "Do 20 more"; else null. */
  moreLabel: string | null;
  showAnswer: () => void;
  /** M6: an action on the card on screen (select an option, type, check, tick…). */
  act: (action: AnswerAction) => void;
  rate: (rating: Rating) => void;
  undo: () => void;
  /** ✕ / "Back to home": finish the session and go home. */
  finish: () => void;
  /** "Do 20 more": finish this capped session and start the next one. */
  more: () => void;
}

/** How often to re-check the queue while idle, so learning cards appear when due. */
const TICK_MS = 15_000;
/** Shortcut keys wait in order for the screen to catch up; at most this many. */
const MAX_PENDING_KEYS = 64;
const SHORTCUT_KEY = /^([ 1-9zZ]|Enter)$/;

/**
 * The review session. Which card comes next always comes from the queue (core
 * buildQueue), so a reload simply rebuilds the session; the only stored session state
 * is its start time (for "reviewed so far" and undo).
 */
export function useReview(deckId: string | null, unit?: number, cap?: number): ReviewViewModel {
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
  const [pressedRating, setPressedRating] = useState<Rating | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Shortcut keys, in order (feel pass). Each applies once the screen shows the result of
  // the one before it, so fast typing never hits a stale card and nothing is dropped,
  // including while a rating saves and the next card comes in.
  const pendingKeys = useRef<string[]>([]);
  const [keyTick, setKeyTick] = useState(0);
  // After a rating or undo is saved, wait for a queue snapshot that includes it before
  // moving on. Otherwise the stale snapshot would show the card just rated again, and
  // it could be rated twice.
  // `clear`: the card just rated. Its answer stays on screen (disabled) until the queue
  // has moved on, then it is cleared so the card starts fresh next time it comes up.
  const [awaiting, setAwaiting] = useState<{
    fingerprint: string;
    pin: string | null;
    clear: string | null;
  } | null>(null);
  const shownAt = useRef(ctx.now());
  // The last card screen shown, kept on screen (leaving) while the next card loads.
  const lastStudying = useRef<ReviewViewModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    startSession(ctx, deckId, browserTimeZone, unit, cap).then(
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
  }, [ctx, deckId, unit, cap, browserTimeZone]);

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
    const fullQueue = await loadQueue(ctx, {
      browserTimeZone,
      ...(deckId === null ? {} : { deckId }),
      ...(unit === undefined ? {} : { unit }),
    });
    // A capped session ("Start with 20") shows only its cards; the rest stay due.
    const queue = session.cap ? capQueue(fullQueue, session.cap) : fullQueue;
    const summary = await sessionSummary(ctx, session);
    const logCount = await ctx.db.reviewLogs.count();
    // Undo only voids this session's logs, so counting voided logs since the session
    // started is enough, and it doesn't scan a big collection's whole history.
    const voidedCount = await ctx.db.reviewLogs
      .where('reviewedAt')
      .aboveOrEqual(session.startedAt)
      .filter((l) => l.voidedAt !== null)
      .count();
    const name = deckId === null ? 'All decks' : ((await ctx.db.decks.get(deckId))?.name ?? 'Deck');
    const deckName = unit === undefined ? name : `${name} · Unit ${String(unit)}`;
    const lastRating = await lastSessionRating(ctx, session.startedAt);
    const done = nextCard(queue) === null;
    const nextDue = done ? await loadNextDue(ctx, { browserTimeZone }) : null;
    const recap = done ? await sessionRecap(ctx, session) : null;
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
      recap,
      // Due cards past a capped session's cap, for "Do 20 more".
      moreDue: session.cap ? fullQueue.due.length : 0,
    };
  }, [ctx, session, deckId, unit, browserTimeZone, tick]);

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
      const { clear } = awaiting;
      if (clear !== null) {
        setAnswers((all) => {
          const { [clear]: _done, ...rest } = all;
          return rest;
        });
      }
      setPinnedId(awaiting.pin);
      shownAt.current = ctx.now();
      setAwaiting(null);
      setPressedRating(null);
      setBusy(false);
    }
  }, [ctx, awaiting, queueData]);

  const cardQuery = useQuery(
    () => (currentId === null ? Promise.resolve(null) : loadReviewCard(ctx, currentId)),
    [ctx, currentId, tick],
  );
  // A live query keeps its last result while the next one loads: only the card the
  // queue picked counts. Until it has loaded, the previous card stays on screen, leaving.
  const loadedCard = cardQuery.status === 'ready' ? cardQuery.data : null;
  const reviewCard = loadedCard?.card.id === currentId ? loadedCard : null;
  const settling = currentId !== null && reviewCard === null;
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
      setPressedRating(rating);
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
          // Busy until the queue reflects this rating; then the next card is picked.
          setAwaiting({ fingerprint, pin: null, clear: currentId });
        })
        .catch(() => {
          pendingKeys.current = [];
          setActionError('Couldn’t save that rating. Please try again.');
          setPressedRating(null);
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
    pendingKeys.current = [];
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
        setAwaiting({ fingerprint, pin: undone.cardId, clear: null });
      })
      .catch(() => {
        setActionError('Couldn’t undo. Please try again.');
        setBusy(false);
      });
  }, [ctx, session, canUndo, queueData]);

  const endSession = useCallback(
    (then: () => void) => {
      // Records session_completed / session_abandoned (M4), then syncs in the background:
      // the end of a study session is a sync trigger (§8.4).
      pendingKeys.current = [];
      const outcome = {
        reviewed: queueData?.summary.reviewed ?? 0,
        remaining: queueData ? remainingCount(queueData.queue) : 0,
        timeSpentMs: queueData?.summary.timeSpentMs ?? 0,
      };
      void finishSession(ctx, outcome)
        .then(() => sync.requestSync())
        .finally(then);
    },
    [ctx, sync, queueData],
  );

  const finish = useCallback(() => {
    endSession(() => void navigate('/'));
  }, [endSession, navigate]);

  const more = useCallback(() => {
    // A new location (same URL) remounts the review screen: a fresh capped session.
    endSession(() => void navigate(`/study?cap=${String(cap ?? 20)}`, { replace: true }));
  }, [endSession, navigate, cap]);

  // Keyboard (§6.3): per type (answer.ts shortcut), plus Z to undo. Never while typing;
  // a text field handles its own Enter (check).
  const handleKey = useCallback(
    (key: string): boolean => {
      if (key === 'z' || key === 'Z') {
        undo();
        return true;
      }
      if (content === null || answer === null) return false;
      const hit = shortcut(content, answer, key);
      if (hit === null) return false;
      if ('rate' in hit) rate(hit.rate);
      else act(hit.action);
      return true;
    },
    [content, answer, act, rate, undo],
  );
  const waiting = busy || settling;

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
      // A held-down key repeats: only real presses count.
      if (!SHORTCUT_KEY.test(event.key) || event.repeat) return;
      event.preventDefault();
      if (pendingKeys.current.length < MAX_PENDING_KEYS) pendingKeys.current.push(event.key);
      setKeyTick((t) => t + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Applies the next waiting key against what is on screen now; never while a rating
  // saves or the next card loads (those keys are for the next card).
  useEffect(() => {
    if (waiting) return;
    // A key that does nothing here (e.g. a rating before the answer) is skipped.
    let key = pendingKeys.current.shift();
    while (key !== undefined && !handleKey(key)) key = pendingKeys.current.shift();
    // More waiting: look again after this key's update has rendered.
    if (key !== undefined && pendingKeys.current.length > 0) setKeyTick((t) => t + 1);
  }, [waiting, handleKey, keyTick]);

  const remaining = queueData ? remainingCount(queueData.queue) : 0;
  const total = reviewed + remaining;
  const recap = queueData?.recap ?? null;
  const moreDue = queueData?.moreDue ?? 0;
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
    cardKey: `${currentId ?? ''}:${String(reviewed)}`,
    leaving: false,
    pressedRating: null,
    announcement: '',
    actionError,
    completionText: completionSentence(reviewed, queueData?.summary.timeSpentMs ?? 0),
    nextDueText: queueData?.nextDue ? nextDueLine(queueData.nextDue) : '',
    rememberedText: recap ? rememberedLine(recap.remembered, recap.reviewed) : '',
    farOffText: recap ? farOffLine(recap.farOff) : null,
    moreLabel: moreDue > 0 ? `Do ${String(Math.min(cap ?? 20, moreDue))} more` : null,
    showAnswer,
    act,
    rate,
    undo,
    finish,
    more,
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
  if (!reviewCard) {
    // The next card is loading: keep the one that was just rated, on its way out.
    if (settling && lastStudying.current) {
      return { ...lastStudying.current, busy: true, leaving: true };
    }
    return { ...base, status: 'loading' };
  }

  const ratings = ([1, 2, 3, 4] as const).map((r) => ({
    rating: r,
    label: RATING_LABELS[r],
    interval: formatInterval(reviewCard.preview[r]),
    key: String(r) as RatingOption['key'],
  }));

  const studying: ReviewViewModel = {
    ...base,
    status: 'studying',
    card: reviewCard.card,
    answer,
    stage,
    kind: reviewCard.state.state === 'new' ? 'New' : 'Review',
    revealed,
    showHint: !queueData.everReviewed && !revealed,
    ratings,
    // Rated: the card leaves (after the button's pressed moment) while the rating saves.
    leaving: pressedRating !== null,
    pressedRating,
    announcement: revealed ? 'Answer shown' : '',
  };
  lastStudying.current = studying;
  return studying;
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { formatDuration } from '../../services/format';
import { loadNextDue, type NextDue } from '../../services/overview';
import { completeSession, getSession, sessionSummary } from '../../services/session';

export interface SessionCompleteViewModel {
  status: 'loading' | 'error' | 'ready';
  /** False when there was no session to summarise (e.g. the page was reloaded). */
  hasSummary: boolean;
  reviewed: number;
  /** e.g. "4m 12s". */
  timeSpent: string;
  /** e.g. "12 cards due tomorrow". */
  nextDue: string;
  backToHome: () => void;
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** "Thu 15 Oct" for a study-day key like "2026-10-15". */
function formatDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

export function nextDueText(next: NextDue): string {
  switch (next.kind) {
    case 'none':
      return 'No cards are scheduled yet.';
    case 'laterToday':
      return `${plural(next.count, 'card')} due later today`;
    case 'tomorrow':
      return `${plural(next.count, 'card')} due tomorrow`;
    case 'later':
      return `${plural(next.count, 'card')} due on ${formatDay(next.day)}`;
  }
}

/**
 * Loads the summary once, then marks the session completed (so the next study
 * session starts fresh). Completing is idempotent and keeps the summary readable, so
 * a reload, or React running the effect twice in development, shows the same result.
 */
export function useSessionComplete(): SessionCompleteViewModel {
  const { ctx, browserTimeZone } = useServices();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; reviewed: number; timeSpentMs: number; hasSummary: boolean; next: NextDue }
  >({ status: 'loading' });

  useEffect(() => {
    // An object, not a `let`: TypeScript can't see the cleanup mutate a local inside the async closure.
    const run = { cancelled: false };
    (async () => {
      const session = await getSession(ctx);
      const summary = session ? await sessionSummary(ctx, session) : null;
      const next = await loadNextDue(ctx, { browserTimeZone });
      if (session) await completeSession(ctx);
      if (!run.cancelled) {
        setState({
          status: 'ready',
          reviewed: summary?.reviewed ?? 0,
          timeSpentMs: summary?.timeSpentMs ?? 0,
          hasSummary: summary !== null,
          next,
        });
      }
    })().catch(() => {
      if (!run.cancelled) setState({ status: 'error' });
    });
    return () => {
      run.cancelled = true;
    };
  }, [ctx, browserTimeZone]);

  const backToHome = () => {
    void navigate('/');
  };

  if (state.status !== 'ready') {
    return {
      status: state.status,
      hasSummary: false,
      reviewed: 0,
      timeSpent: '',
      nextDue: '',
      backToHome,
    };
  }
  return {
    status: 'ready',
    hasSummary: state.hasSummary,
    reviewed: state.reviewed,
    timeSpent: formatDuration(state.timeSpentMs),
    nextDue: nextDueText(state.next),
    backToHome,
  };
}

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { loadQueue } from '../../services/queue';
import { getSettings } from '../../services/settings';
import { syncStatusView, type SyncStatusView } from '../../services/syncStatus';
import { resolveTheme, THEME_STORAGE_KEY } from '../../services/theme';
import { isTypingTarget } from './keyboard';

export interface ShellViewModel {
  /** Cards to study today (due + learning + new), for the Home badge. Null while loading. */
  todayCount: number | null;
  sync: SyncStatusView;
}

/**
 * App-wide effects and the data the navigation shows:
 * - applies the theme (and follows the OS live when it is "system"), mirroring it to
 *   localStorage for the no-flash script in index.html;
 * - commits pending deletes when the page goes away;
 * - "/" opens search.
 */
export function useShell(): ShellViewModel {
  const { ctx, browserTimeZone, pendingDeletes } = useServices();
  const navigate = useNavigate();
  const settings = useQuery(() => getSettings(ctx), [ctx]);
  const theme = settings.status === 'ready' ? settings.data.theme : null;
  const counts = useQuery(
    () => loadQueue(ctx, { browserTimeZone }).then((q) => q.counts),
    [ctx, browserTimeZone],
  );

  useEffect(() => {
    if (theme === null) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable: the theme still applies for this page load.
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = resolveTheme(theme, media.matches);
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [theme]);

  useEffect(() => {
    // Leaving the page counts as the undo toast timing out: write the tombstones now.
    const onPageHide = () => {
      void pendingDeletes.flushAll();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [pendingDeletes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      void navigate('/search');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate]);

  const todayCount =
    counts.status === 'ready' ? counts.data.due + counts.data.learning + counts.data.new : null;
  return {
    todayCount,
    // There is no sync engine yet (M2 was paused before it), so the app is always
    // "on this device only". The view supports every state for when sync exists.
    sync: syncStatusView({ kind: 'signedOut' }, ctx.now()),
  };
}

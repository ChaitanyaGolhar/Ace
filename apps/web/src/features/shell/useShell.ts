import { useEffect } from 'react';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import type { Theme } from '../../db/meta';
import { getSettings } from '../../services/settings';

/** App-wide effects: apply the theme, and commit pending deletes when the page goes away. */
export function useShell(): { theme: Theme | null } {
  const { ctx, pendingDeletes } = useServices();
  const settings = useQuery(() => getSettings(ctx), [ctx]);
  const theme = settings.status === 'ready' ? settings.data.theme : null;

  useEffect(() => {
    if (theme === null) return;
    // No visual design yet: only tell the browser which built-in scheme to use.
    document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
    document.documentElement.dataset.theme = theme;
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

  return { theme };
}

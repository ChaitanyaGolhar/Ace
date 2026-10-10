import type { Theme } from '../db/meta';

export type ResolvedTheme = 'light' | 'dark';

/** Mirror of the theme setting in localStorage, read by the inline script in index.html
 * so the right theme is applied before first paint (IndexedDB is async; this isn't). */
export const THEME_STORAGE_KEY = 'recall.theme';

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

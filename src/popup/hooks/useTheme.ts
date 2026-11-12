import { useLayoutEffect, useSyncExternalStore } from 'react';
import { resolveTheme, type EffectiveTheme, type ThemePreference } from '../../shared/settings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Current OS colour-scheme preference (dark when it cannot be determined, matching the default). */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return true;
  }
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(DARK_QUERY);
  } catch {
    return () => {};
  }
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Apply an effective theme to the popup document (tokens are switched by html[data-theme]). */
export function applyTheme(theme: EffectiveTheme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Resolve the theme preference ("system" follows the OS live) and keep <html data-theme> in sync.
 * Returns the effective theme.
 */
export function useEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark);
  const theme = resolveTheme(preference, prefersDark);
  // Layout effect: switch before the browser paints, so a change never shows mixed colours.
  useLayoutEffect(() => applyTheme(theme), [theme]);
  return theme;
}

/**
 * Popup entry point.
 *
 * Boot order is chosen so the popup paints once, already correct:
 *   1. inject the design tokens (--mt-*) for both themes,
 *   2. read the saved settings (a few ms) and apply the effective theme to <html>,
 *   3. render React with those settings, so switches never animate from default values.
 * Until step 2 the page is dark (popup.html + popup.css fallbacks), matching the default theme.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { themedTokensCss } from '../shared/brand';
import { resolveTheme } from '../shared/settings';
import { loadSettings } from '../shared/storage';
import { App } from './App';
import { applyTheme, systemPrefersDark } from './hooks/useTheme';
import './popup.css';

function injectTokens(): void {
  const style = document.createElement('style');
  style.id = 'mt-tokens';
  style.textContent = themedTokensCss(':root');
  document.head.prepend(style);
}

async function boot(): Promise<void> {
  injectTokens();
  // loadSettings never rejects: it falls back to defaults when storage is unavailable.
  const settings = await loadSettings();
  applyTheme(resolveTheme(settings.theme, systemPrefersDark()));

  const container = document.getElementById('root');
  if (!container) throw new Error('MonoTube popup: #root is missing from popup.html');
  createRoot(container).render(
    <StrictMode>
      <App initialSettings={settings} />
    </StrictMode>,
  );
}

void boot();

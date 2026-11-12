import { SETTINGS_KEY } from './constants';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './settings';

/** Read settings from chrome.storage.local (defaults when absent or unreadable). */
export async function loadSettings(): Promise<Settings> {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(data[SETTINGS_KEY]);
  } catch {
    // Extension context invalidated (extension reloaded while the page stayed open) or storage error.
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Merge a partial update into the stored settings and persist it. Returns the new settings.
 * Reads storage directly (errors propagate) so a failed read can never cause the user's other
 * choices to be overwritten with defaults.
 */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const current = normalizeSettings(data[SETTINGS_KEY]);
  const next = normalizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Subscribe to settings changes from any context (popup, service worker, other tabs).
 * Returns an unsubscribe function.
 */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(SETTINGS_KEY in changes)) return;
    callback(normalizeSettings(changes[SETTINGS_KEY]?.newValue));
  };
  try {
    chrome.storage.onChanged.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* context invalidated */
    }
  };
}

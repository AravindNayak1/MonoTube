import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeSettings, type Settings } from '../../shared/settings';
import { loadSettings, onSettingsChanged, saveSettings } from '../../shared/storage';

/** Settings keys whose value is a boolean switch. */
export type ToggleKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

export interface SettingsController {
  /** What the UI shows: the stored settings with not-yet-saved local changes applied on top. */
  settings: Settings;
  /** Apply a change immediately (optimistic) and persist it; reverted if saving fails. */
  update: (patch: Partial<Settings>) => void;
  /** Last save error, for a transient notice. */
  error: string | null;
  dismissError: () => void;
}

/**
 * Live settings for the popup.
 *
 * - Optimistic: `update` changes the UI at once, then saves.
 * - Saves are queued, because saveSettings is read-modify-write: two concurrent saves (fast clicks
 *   on two switches) would otherwise each read the old object and the later write would undo the
 *   earlier one.
 * - External changes (Alt+M, another window, the restore action) arrive via onSettingsChanged and
 *   become the new baseline; local changes still in flight stay on top so nothing flickers.
 */
export function useSettings(initial: Settings): SettingsController {
  /** Last value known to be in storage. */
  const stored = useRef<Settings>(initial);
  /** Changes shown in the UI but not saved yet, oldest first. */
  const pending = useRef<Partial<Settings>[]>([]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [settings, setSettings] = useState<Settings>(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSettings(normalizeSettings(Object.assign({}, stored.current, ...pending.current)));
  }, []);

  useEffect(() => {
    let changed = false;
    const unsubscribe = onSettingsChanged((next) => {
      changed = true;
      stored.current = next;
      refresh();
    });
    // Catch a change that landed between the initial read (main.tsx) and this subscription.
    // Ignored if a change event already arrived, since that one is at least as new.
    void loadSettings().then((latest) => {
      if (changed) return;
      stored.current = latest;
      refresh();
    });
    return unsubscribe;
  }, [refresh]);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      pending.current = [...pending.current, patch];
      refresh();
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          stored.current = await saveSettings(patch);
        } catch (err) {
          console.warn('MonoTube: could not save settings', err);
          setError('Couldn’t save that change. Please try again.');
        } finally {
          // Dropping the patch either confirms it (now part of `stored`) or reverts it.
          pending.current = pending.current.filter((p) => p !== patch);
          refresh();
        }
      });
    },
    [refresh],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { settings, update, error, dismissError };
}

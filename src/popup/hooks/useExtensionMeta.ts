import { useEffect, useState } from 'react';
import { COMMAND_TOGGLE } from '../../shared/constants';

/** Shortcut suggested in the manifest; shown until the real binding is known. */
export const DEFAULT_SHORTCUT = 'Alt+M';

export interface ExtensionMeta {
  /** Extension version from the manifest, or null outside the extension. */
  version: string | null;
  /** Shortcut currently bound to the toggle command; '' when the user removed it. */
  shortcut: string;
}

function readVersion(): string | null {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return null;
  }
}

/**
 * Version and the live Alt+M binding (the user can rebind or clear it in chrome://extensions/shortcuts,
 * so the footer shows what actually works rather than the suggested key).
 */
export function useExtensionMeta(): ExtensionMeta {
  const [version] = useState(readVersion);
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);

  useEffect(() => {
    let alive = true;
    try {
      chrome.commands
        .getAll()
        .then((commands) => {
          const command = commands.find((c) => c.name === COMMAND_TOGGLE);
          if (alive && command) setShortcut(command.shortcut ?? '');
        })
        .catch(() => {
          /* keep the suggested key */
        });
    } catch {
      /* chrome.commands unavailable: keep the suggested key */
    }
    return () => {
      alive = false;
    };
  }, []);

  return { version, shortcut };
}

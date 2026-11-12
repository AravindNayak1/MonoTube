import type { MouseEvent } from 'react';
import { Icon } from './Icon';

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

interface FooterProps {
  version: string | null;
  /** Current binding of the toggle command; '' when none is set. */
  shortcut: string;
}

/** chrome:// pages cannot be opened by a plain link from an extension page; open them as a tab. */
function openShortcuts(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  try {
    chrome.tabs.create({ url: SHORTCUTS_URL }).catch((err: unknown) => {
      console.warn('MonoTube: could not open the shortcuts page', err);
    });
  } catch (err) {
    console.warn('MonoTube: could not open the shortcuts page', err);
  }
}

export function Footer({ version, shortcut }: FooterProps) {
  return (
    <footer className="footer">
      {version && <span className="footer-version">v{version}</span>}
      {version && (
        <span className="footer-sep" aria-hidden="true">
          ·
        </span>
      )}
      <span className="footer-hint">
        {shortcut ? (
          <>
            <kbd>{shortcut}</kbd> toggles MonoTube
          </>
        ) : (
          'No toggle shortcut set'
        )}
      </span>
      <a className="footer-link" href={SHORTCUTS_URL} onClick={openShortcuts}>
        Shortcuts
        <Icon name="arrowUpRight" size={13} />
      </a>
    </footer>
  );
}

/**
 * Helpers that drive YouTube's own single-page navigation so MonoTube never forces full page
 * reloads. Verified (Nov 2026): filling YouTube's masthead search input and clicking its search
 * button, or clicking any `a.yt-simple-endpoint`, performs a client-side navigation.
 * Every helper falls back to a normal location change if YouTube's app isn't ready or the
 * navigation doesn't start within a short timeout.
 */

import { LAST_QUERY_KEY } from '../shared/constants';
import { buildSearchPath, getSearchQuery } from '../shared/navigation';
import { queryFirst, SEL } from '../shared/selectors';

const NAV_START_TIMEOUT_MS = 900;

/** Resolves true if YouTube announces a navigation (yt-navigate-start) within the timeout. */
function waitForNavigateStart(timeout = NAV_START_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      document.removeEventListener('yt-navigate-start', onStart, true);
      clearTimeout(timer);
      resolve(v);
    };
    const onStart = () => done(true);
    const timer = window.setTimeout(() => done(false), timeout);
    document.addEventListener('yt-navigate-start', onStart, true);
  });
}

/**
 * After an SPA navigation YouTube moves focus to its "Skip navigation" button when focus is on
 * <body> — which is where it lands when MonoTube's homepage overlay (holding focus) disappears,
 * so the button would pop up after every MonoTube-initiated search. For a few seconds after such a
 * navigation, bounce that programmatic focus. Any key press cancels the guard, so keyboard users
 * can still Tab to the button.
 */
function guardSkipNavigationFocus(ms = 4_000): void {
  const stop = () => {
    document.removeEventListener('focusin', onFocus, true);
    window.removeEventListener('keydown', stop, true);
    clearTimeout(timer);
  };
  const onFocus = (e: FocusEvent) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.closest('#skip-navigation')) t.blur();
  };
  const timer = window.setTimeout(stop, ms);
  document.addEventListener('focusin', onFocus, true);
  window.addEventListener('keydown', stop, true);
}

function hardNavigate(path: string): void {
  location.assign(new URL(path, location.origin).href);
}

/** Remember the last query for "Back to results" (per tab; YouTube already sees it in the URL). */
export function rememberQuery(query: string): void {
  try {
    sessionStorage.setItem(LAST_QUERY_KEY, query);
  } catch {
    /* storage blocked */
  }
}

export function lastQuery(): string | null {
  try {
    return sessionStorage.getItem(LAST_QUERY_KEY);
  } catch {
    return null;
  }
}

/**
 * Run a genuine YouTube search for `query` using YouTube's own search box (SPA navigation),
 * falling back to loading /results?search_query=... directly.
 */
export async function submitSearch(query: string): Promise<void> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return;
  rememberQuery(q);
  const path = buildSearchPath(q);
  const input = queryFirst<HTMLInputElement>(SEL.searchInput);
  const button = queryFirst<HTMLButtonElement>(SEL.searchButton);
  const appReady = !!queryFirst(SEL.app) && !!input;
  if (!appReady) return hardNavigate(path);

  guardSkipNavigationFocus();
  const started = waitForNavigateStart();
  const finished = waitForEvent('yt-navigate-finish', 8_000);
  // Deliberately no synthetic "input" event: YouTube reads input.value on submit (verified), and an
  // input event makes it fetch suggestions whose dropdown can pop open over the results page.
  input.value = q;
  if (button) {
    button.click();
  } else {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', init));
  }
  if (!(await started)) {
    if (!showingResultsFor(q)) hardNavigate(path);
    return;
  }
  input.blur();
  // Safety net: if a future YouTube searchbox ignored the programmatic value, load the exact query.
  if ((await finished) && !showingResultsFor(q)) hardNavigate(path);
}

function showingResultsFor(q: string): boolean {
  return getSearchQuery(new URL(location.href))?.replace(/\s+/g, ' ') === q;
}

/** Resolves true when `type` fires on document within `timeout` ms, false otherwise. */
function waitForEvent(type: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      document.removeEventListener(type, onEvent, true);
      clearTimeout(timer);
      resolve(v);
    };
    const onEvent = () => done(true);
    const timer = window.setTimeout(() => done(false), timeout);
    document.addEventListener(type, onEvent, true);
  });
}

/**
 * Navigate to a same-origin path through YouTube's router when a matching endpoint link exists
 * in the page (e.g. guide entries, logo), else with a normal navigation.
 */
export async function navigateTo(path: string): Promise<void> {
  const target = new URL(path, location.origin);
  let link: HTMLAnchorElement | null = null;
  if (target.pathname === '/' && !target.search) link = queryFirst<HTMLAnchorElement>(SEL.logoLink);
  if (!link) {
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a.yt-simple-endpoint[href]')) {
      const href = a.getAttribute('href');
      if (href && new URL(href, location.origin).href === target.href) {
        link = a;
        break;
      }
    }
  }
  if (!link || !queryFirst(SEL.app)) return hardNavigate(target.href);
  guardSkipNavigationFocus();
  const started = waitForNavigateStart();
  link.click();
  if (!(await started) && location.href !== target.href) hardNavigate(target.href);
}

/** Ask YouTube's player to re-measure itself after MonoTube changed the layout around it. */
export function nudgeLayout(): void {
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

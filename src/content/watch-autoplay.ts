/**
 * Reading and switching YouTube's own Autoplay (autonav) toggle, and the record of whether
 * MonoTube switched it off. Used by the watch module (watch.ts).
 *
 * YouTube behaviour this relies on (verified live, Nov 2026, signed out):
 *  - On a fresh page load the toggle is first drawn as a placeholder, aria-checked="true", whatever
 *    the user's saved preference. About 0.6-1.5 s after playback starts YouTube applies the saved
 *    preference: it writes sessionStorage "yt-player-autonavstate" ({data, creation: Date.now()})
 *    and, when the preference is "off", flips the toggle to "false" a few ms later. Deciding on the
 *    placeholder would click a toggle the user had already switched off (and record that MonoTube
 *    did it), or skip a needed restore. So decisions wait for the settled state.
 *  - SPA navigations keep the player and its toggle, so the state carries over (no placeholder).
 *  - A honoured click flips aria-checked synchronously; early clicks are ignored (no change).
 *  - YouTube persists a change with POST /youtubei/v1/account/set_setting right after the click
 *    (response after ~0.5 s). A reload before that lands brings the old state back.
 */

import { AUTOPLAY_TOUCHED_KEY } from '../shared/constants';
import { queryFirst, SEL, type SelectorList } from '../shared/selectors';
import { waitForAttribute } from './element-state';

export type AutoplayState = 'true' | 'false';

const MAIN_PLAYER = SEL.player[0];

/** Prefer elements inside the main player; keep the unscoped selectors as fallbacks. */
export const inMainPlayer = (list: SelectorList): string[] => [...list.map((sel) => `${MAIN_PLAYER} ${sel}`), ...list];

export const AUTONAV_STATE = inMainPlayer(SEL.autonavState);
const AUTONAV_TOGGLE = inMainPlayer(SEL.autonavToggle);

/** sessionStorage key YouTube writes when it applies the saved Autoplay preference. */
const YT_AUTONAV_STORAGE_KEY = 'yt-player-autonavstate';
/** Wall-clock time this document's content script started (document_start). */
const PAGE_START = Date.now();

/**
 * Longest wait for YouTube to apply the saved preference after content playback started, when
 * neither of its signals (toggle flip, sessionStorage write) shows up. Normally one arrives after
 * ~1 s, but on a busy machine it was seen ~3.8 s after playback started; both signals end the wait
 * early, so a generous cap costs nothing in the usual case.
 */
const SETTLE_MAX_MS = 10_000;
/** After YouTube's sessionStorage write, the toggle flips within a few ms (seen: 20-40 ms). */
const SETTLE_GRACE_MS = 400;
const SETTLE_POLL_MS = 100;
/** Bounded retries: early clicks are ignored until YouTube has wired up the up-next data. */
const TOGGLE_ATTEMPTS = 12;
const TOGGLE_CONFIRM_MS = 1_000;
/** A flip this soon after our click is the click's doing; later ones are YouTube's or the user's. */
const CLICK_ATTRIBUTION_MS = 150;
/** Minimum time "on" must hold after a restore before the record is removed. */
const RESTORE_SETTLE_MS = 1_500;
/** Longest wait for YouTube's set_setting request to complete after a restore click. */
const RESTORE_PERSIST_MAX_MS = 6_000;
const SET_SETTING_PATH = '/youtubei/v1/account/set_setting';

export function readAutoplayState(): AutoplayState | null {
  const value = queryFirst(AUTONAV_STATE)?.getAttribute('aria-checked');
  return value === 'true' || value === 'false' ? value : null;
}

/** True once YouTube has applied its saved Autoplay preference in this document (a while ago). */
function youTubeAppliedSavedState(): boolean {
  try {
    const raw = sessionStorage.getItem(YT_AUTONAV_STORAGE_KEY);
    if (!raw) return false;
    const creation = (JSON.parse(raw) as { creation?: unknown } | null)?.creation;
    // An entry from an earlier document in this tab (e.g. before a reload) says nothing yet.
    return typeof creation === 'number' && creation >= PAGE_START && Date.now() - creation >= SETTLE_GRACE_MS;
  } catch {
    return false;
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = window.setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * The toggle state YouTube ends on: waits (after content playback started) until YouTube applied
 * the saved preference, i.e. the placeholder flipped, YouTube wrote its sessionStorage record, or
 * SETTLE_MAX_MS passed. Resolves null when aborted or when the toggle is gone.
 */
export async function settledAutoplayState(signal: AbortSignal): Promise<AutoplayState | null> {
  const start = Date.now();
  let el = queryFirst(AUTONAV_STATE);
  if (!el) return null;
  const initial = el.getAttribute('aria-checked');
  while (!signal.aborted) {
    if (!el.isConnected) {
      el = queryFirst(AUTONAV_STATE);
      if (!el) return null;
    }
    const current = el;
    // A flip away from the first-drawn state is YouTube applying the saved preference (or the user
    // switching it): either way, that is the state to respect.
    if (current.getAttribute('aria-checked') !== initial) break;
    if (youTubeAppliedSavedState() || Date.now() - start >= SETTLE_MAX_MS) break;
    await waitForAttribute(current, ['aria-checked'], () => current.getAttribute('aria-checked') !== initial, {
      timeout: SETTLE_POLL_MS,
      signal,
    });
  }
  return signal.aborted ? null : readAutoplayState();
}

/**
 * - 'switched': MonoTube's click changed the toggle to `want`.
 * - 'already': it reads `want` without MonoTube's click (YouTube or the user changed it).
 * - 'failed': the toggle is missing, kept ignoring clicks, or the wait was aborted.
 */
export type SwitchResult = 'switched' | 'already' | 'failed';

/** Click YouTube's Autoplay toggle until aria-checked reads `want`. */
export async function switchAutoplay(want: AutoplayState, signal: AbortSignal): Promise<SwitchResult> {
  for (let attempt = 0; attempt < TOGGLE_ATTEMPTS && !signal.aborted; attempt++) {
    const state = queryFirst(AUTONAV_STATE);
    const button = state?.closest<HTMLElement>('button') ?? queryFirst<HTMLElement>(AUTONAV_TOGGLE);
    if (!state || !button) return 'failed';
    const reads = () => state.getAttribute('aria-checked') === want;
    if (reads()) return 'already';
    // A programmatic click works even when YouTube hides the button with inline display:none.
    button.click();
    if (reads()) return 'switched';
    const clickedAt = performance.now();
    const confirmed = await waitForAttribute(state, ['aria-checked'], reads, { timeout: TOGGLE_CONFIRM_MS, signal });
    if (confirmed) return performance.now() - clickedAt <= CLICK_ATTRIBUTION_MS ? 'switched' : 'already';
  }
  return 'failed';
}

/** Resolve true once YouTube's set_setting request started after `since` has completed. */
function waitForSettingSaved(since: number, timeout: number, signal: AbortSignal): Promise<boolean> {
  const isSave = (e: PerformanceEntry) =>
    e.name.includes(SET_SETTING_PATH) && e.startTime >= since - 50 && (e as PerformanceResourceTiming).responseEnd > 0;
  try {
    if (performance.getEntriesByType('resource').some(isSave)) return Promise.resolve(true);
  } catch {
    /* resource timing unavailable */
  }
  return new Promise((resolve) => {
    let po: PerformanceObserver | null = null;
    const finish = (value: boolean) => {
      po?.disconnect();
      po = null;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const timer = window.setTimeout(() => finish(false), timeout);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      po = new PerformanceObserver((list) => {
        if (list.getEntries().some(isSave)) finish(true);
      });
      po.observe({ type: 'resource' });
    } catch {
      po = null; // no observer: the timeout decides
    }
  });
}

/**
 * After a restore, resolve true once the toggle has stayed "on" long enough for YouTube to have
 * persisted it: at least RESTORE_SETTLE_MS, and (after a click of ours, `clickedAt`) until YouTube's
 * set_setting request completed or RESTORE_PERSIST_MAX_MS passed. False if it flips back or aborts.
 */
export async function autoplayStaysOn(clickedAt: number | null, signal: AbortSignal): Promise<boolean> {
  const el = queryFirst(AUTONAV_STATE);
  if (!el || el.getAttribute('aria-checked') !== 'true' || signal.aborted) return false;
  const local = new AbortController();
  const onAbort = () => local.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const flipped = waitForAttribute(el, ['aria-checked'], () => el.getAttribute('aria-checked') !== 'true', {
      signal: local.signal,
    }).then(() => 'flipped' as const);
    const saved = Promise.all([
      delay(RESTORE_SETTLE_MS, local.signal),
      clickedAt === null ? Promise.resolve(true) : waitForSettingSaved(clickedAt, RESTORE_PERSIST_MAX_MS, local.signal),
    ]).then(() => 'saved' as const);
    const outcome = await Promise.race([flipped, saved]);
    return outcome === 'saved' && !signal.aborted && el.isConnected && readAutoplayState() === 'true';
  } finally {
    local.abort();
    signal.removeEventListener('abort', onAbort);
  }
}

// ── "MonoTube switched Autoplay off" record ─────────────────────────────────────────────────

/**
 * chrome.storage.local is shared between the regular profile and incognito ("spanning" mode), but
 * YouTube's preference lives in separate cookie jars/visitor sessions. An incognito tab must not
 * read or write the regular profile's record: there the record is kept for this page only.
 */
function inIncognito(): boolean {
  try {
    return chrome.extension?.inIncognitoContext === true;
  } catch {
    return false;
  }
}

let touchedThisPage = false;

/** Persist (or clear) "MonoTube switched YouTube's Autoplay off". */
export function setTouched(touched: boolean): void {
  touchedThisPage = touched;
  if (inIncognito()) return;
  try {
    const op = touched
      ? chrome.storage.local.set({ [AUTOPLAY_TOUCHED_KEY]: true })
      : chrome.storage.local.remove(AUTOPLAY_TOUCHED_KEY);
    op.catch(() => {});
  } catch {
    /* extension context invalidated */
  }
}

export async function wasTouched(): Promise<boolean> {
  if (inIncognito()) return touchedThisPage;
  try {
    const data = await chrome.storage.local.get(AUTOPLAY_TOUCHED_KEY);
    return data[AUTOPLAY_TOUCHED_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Theme module.
 *
 * 1. MonoTube's own UI (homepage, nav pill, notices, buttons) follows the effective MonoTube
 *    theme instantly, through the Shadow DOM theme scope.
 *
 * 2. YouTube's own pages are aligned with it through YouTube's *own* appearance preference, the
 *    PREF cookie's "f6" bit field (verified Nov 2026: 0x400 = dark, 0x80000 = light).
 *    Why not just toggle the `dark` attribute YouTube puts on <html>? Because YouTube's boot
 *    removes it when its preference says light, and components created in that same task compute
 *    JavaScript-driven light styles; re-adding `dark` afterwards produced mixed, broken rendering
 *    (e.g. white text on white chips). YouTube renders a theme correctly only when its server
 *    rendered the page with that preference, so MonoTube:
 *      - writes the preference bits whenever the MonoTube theme changes (applies on the next
 *        page load; MonoTube's own UI switches immediately),
 *      - on page load, if YouTube rendered the other theme, reloads once BEFORE any MonoTube UI is
 *        shown (prepareYouTubeTheme, awaited by index.ts), guarded per tab so it can never loop
 *        (e.g. when cookies are blocked),
 *      - remembers the user's original bits the first time it changes them and puts them back
 *        when MonoTube is turned off ("Restore original YouTube" included).
 *
 * 3. A single write does not stick. An open YouTube page keeps PREF in memory and writes the
 *    whole cookie back from that copy whenever it saves any preference (during its boot, or when
 *    its Autoplay toggle is clicked, which the watch module does right after MonoTube is turned
 *    off), and that copy holds the bits the page loaded with. So each page keeps the bits it wants
 *    (MonoTube's while enabled, the original while a restore is pending) and puts them back after
 *    such rewrites and when it is left; and the record of the original bits is kept until a page
 *    load finds the cookie already holding them.
 *
 * 4. Incognito is left alone: its PREF cookie lives in a separate cookie jar (discarded with the
 *    incognito session) while chrome.storage, and so the record, is shared with the regular
 *    profile. Touching it could consume or overwrite the regular profile's record.
 */

import { YOUTUBE_THEME_ORIGINAL_KEY } from '../shared/constants';
import type { EffectiveTheme } from '../shared/settings';
import type { FeatureModule, ModuleContext } from './types';

const DARK_BIT = 0x400;
const LIGHT_BIT = 0x80000;
const THEME_BITS = DARK_BIT | LIGHT_BIT;
const COOKIE = 'PREF';
const COOKIE_ATTRS = '; domain=.youtube.com; path=/; max-age=63072000; secure; samesite=lax';
/** sessionStorage guard: the theme this tab already reloaded for (prevents reload loops). */
const RELOAD_GUARD_KEY = 'monotube:themeReload';
/** Re-check interval for the kept theme bits when the Cookie Store API is unavailable. */
const KEEP_POLL_MS = 2_000;

// ── PREF cookie helpers ──────────────────────────────────────────────────────────────────────

function readPref(): [string, string][] {
  const m = /(?:^|;\s*)PREF=([^;]*)/.exec(document.cookie);
  if (!m?.[1]) return [];
  return m[1]
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)];
    });
}

export function readThemeBits(): number {
  const f6 = readPref().find(([k]) => k === 'f6')?.[1];
  const value = f6 ? parseInt(f6, 16) : 0;
  return Number.isFinite(value) ? value & THEME_BITS : 0;
}

export function writeThemeBits(bits: number): void {
  const pairs = readPref();
  const entry = pairs.find(([k]) => k === 'f6');
  const current = entry ? parseInt(entry[1], 16) || 0 : 0;
  const next = ((current & ~THEME_BITS) | (bits & THEME_BITS)) >>> 0;
  if (next === current) return; // also: never create an empty PREF just to say "no theme bits"
  if (entry) entry[1] = next.toString(16);
  else pairs.unshift(['f6', next.toString(16)]);
  // Drop f6 entirely when it would be 0, as YouTube itself does.
  const serialized = pairs
    .filter(([k, v]) => !(k === 'f6' && v === '0'))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  document.cookie = `${COOKIE}=${serialized}${COOKIE_ATTRS}`;
}

const bitsFor = (theme: EffectiveTheme): number => (theme === 'dark' ? DARK_BIT : LIGHT_BIT);

/**
 * Whether YouTube's server renders a page dark for these bits. Verified Nov 2026: only the dark
 * bit does. "Device theme" (no bits) is rendered light even for a dark OS (with or without the
 * Sec-CH-Prefers-Color-Scheme hint); YouTube's own script follows the OS after boot.
 */
const rendersDark = (bits: number): boolean => (bits & DARK_BIT) !== 0;

function inIncognito(): boolean {
  try {
    return chrome.extension?.inIncognitoContext === true;
  } catch {
    return false;
  }
}

/**
 * Theme bits YouTube's in-memory PREF copy on this page can hold: what the cookie held when the
 * page started, plus everything MonoTube wrote while enabled. When YouTube saves any preference it
 * writes one of these back. A value outside this set can only come from the user picking a new
 * appearance in YouTube's own menu.
 */
const pageBits = new Set<number>();
try {
  pageBits.add(readThemeBits()); // runs at document_start, before YouTube's scripts
} catch {
  /* no document (unit tests in Node) */
}

// ── extension storage helpers (context may be invalidated) ───────────────────────────────────

async function getOriginalBits(): Promise<number | null> {
  try {
    const v = (await chrome.storage.local.get(YOUTUBE_THEME_ORIGINAL_KEY))[YOUTUBE_THEME_ORIGINAL_KEY];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

async function setOriginalBits(bits: number | null): Promise<void> {
  try {
    if (bits === null) await chrome.storage.local.remove(YOUTUBE_THEME_ORIGINAL_KEY);
    else await chrome.storage.local.set({ [YOUTUBE_THEME_ORIGINAL_KEY]: bits });
  } catch {
    /* context invalidated */
  }
}

// ── reload guard ─────────────────────────────────────────────────────────────────────────────

/** Reload (to the URL the user originally requested) unless this tab already did for `key`. */
function reloadOnceFor(key: string, landingHref: string): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === key) return false; // already tried: never loop
    sessionStorage.setItem(RELOAD_GUARD_KEY, key);
  } catch {
    return false; // no sessionStorage, no safe guard: skip the reload
  }
  // replace() with the landing URL (not reload()): YouTube may already have rewritten the URL and
  // dropped parameters MonoTube needs, e.g. ?mt_shorts=<id> from the Shorts redirect.
  location.replace(landingHref);
  return true;
}

function clearReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    /* ignore */
  }
}

// ── keeping PREF's theme bits on this page ───────────────────────────────────────────────────

/**
 * The theme bits this page keeps in PREF: MonoTube's while enabled, the user's original while
 * MonoTube is off and that restore is not yet confirmed by a page load (`restoring`). Null when
 * there is nothing to keep (MonoTube off with no record, incognito, before boot alignment).
 */
let keep: { bits: number; restoring: boolean } | null = null;
let stopKeepListeners: (() => void) | null = null;

/** Put the kept bits back if YouTube wrote its stale in-memory copy over them. */
function healPref(): void {
  if (!keep) return;
  const current = readThemeBits();
  if (current === keep.bits) return;
  if (pageBits.has(current)) {
    writeThemeBits(keep.bits);
    return;
  }
  // A value this page's YouTube never held: the user picked an appearance in YouTube's own menu.
  // While MonoTube is on, the next page load realigns it (as always). While restoring, it replaces
  // the original: the restore is over.
  if (keep.restoring) {
    stopKeeping();
    void setOriginalBits(null);
  }
}

/** Keep `bits` in PREF for the rest of this page's life, or until the state changes. */
function keepThemeBits(bits: number, restoring: boolean): void {
  keep = { bits, restoring };
  if (stopKeepListeners) return;
  const heal = () => healPref();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') healPref();
  };
  // beforeunload runs before a reload's request is sent (with the cookie), pagehide covers the rest.
  window.addEventListener('beforeunload', heal);
  window.addEventListener('pagehide', heal);
  document.addEventListener('visibilitychange', onVisibility);
  // Cookie changes (YouTube's own writes included) are reported within milliseconds where the
  // Cookie Store API exists (Chrome, verified Nov 2026); poll otherwise.
  const cookieStore = (window as unknown as { cookieStore?: EventTarget }).cookieStore;
  let poll = 0;
  if (cookieStore) cookieStore.addEventListener('change', heal);
  else poll = window.setInterval(heal, KEEP_POLL_MS);
  stopKeepListeners = () => {
    window.removeEventListener('beforeunload', heal);
    window.removeEventListener('pagehide', heal);
    document.removeEventListener('visibilitychange', onVisibility);
    cookieStore?.removeEventListener('change', heal);
    if (poll) clearInterval(poll);
  };
}

function stopKeeping(): void {
  keep = null;
  stopKeepListeners?.();
  stopKeepListeners = null;
}

// ── alignment ────────────────────────────────────────────────────────────────────────────────

/**
 * Boot-time alignment, run by index.ts after settings load and BEFORE any module renders, so a
 * reload can never interrupt something the user started. Returns true when the page is reloading
 * (the caller must then not boot the modules).
 *
 * @param renderedDark whether YouTube's server rendered this page dark (<html dark> at document_start)
 * @param landingHref  location.href at document_start
 */
export async function prepareYouTubeTheme(
  enabled: boolean,
  theme: EffectiveTheme,
  renderedDark: boolean,
  landingHref: string,
): Promise<boolean> {
  if (inIncognito()) return false;
  const original = await getOriginalBits();
  const current = readThemeBits();
  pageBits.add(current);
  if (enabled) {
    const wanted = bitsFor(theme);
    if (current !== wanted) {
      if (original === null) await setOriginalBits(current);
      pageBits.add(wanted);
      writeThemeBits(wanted);
    }
    if (renderedDark === (theme === 'dark')) clearReloadGuard();
    else if (reloadOnceFor(theme, landingHref)) return true;
    keepThemeBits(wanted, false);
    return false;
  }
  // MonoTube off: hand YouTube its own preference back.
  if (original === null) {
    clearReloadGuard();
    return false;
  }
  const wrongRender = renderedDark !== rendersDark(original);
  if (current === original) {
    // This load found the user's own bits in place: the restore is complete.
    await setOriginalBits(null);
    // The request may still have carried MonoTube's bits (an open page put the original back only
    // as this tab navigated): reload once so YouTube renders the user's theme.
    if (wrongRender) return reloadOnceFor('restore', landingHref);
    clearReloadGuard();
    return false;
  }
  // Still MonoTube's bits (the restore never reached the cookie, or an open page wrote YouTube's
  // stale copy back): write the original again and keep the record until a load confirms it.
  writeThemeBits(original);
  if (wrongRender && reloadOnceFor('restore', landingHref)) return true;
  keepThemeBits(original, true); // this page's YouTube read MonoTube's bits too
  return false;
}

/**
 * Live (post-boot) sync: update YouTube's preference; it applies on the next page load.
 * `isCurrent` is false once a newer change is queued, which then redoes this from scratch.
 */
async function syncLive(enabled: boolean, theme: EffectiveTheme, isCurrent: () => boolean): Promise<void> {
  if (inIncognito()) return;
  const original = await getOriginalBits();
  if (!isCurrent()) return;
  if (enabled) {
    const wanted = bitsFor(theme);
    const current = readThemeBits();
    if (current !== wanted) {
      if (original === null) await setOriginalBits(current);
      pageBits.add(wanted);
      writeThemeBits(wanted);
    }
    // Only now, after the record above: keeping earlier could overwrite the user's bits unrecorded.
    keepThemeBits(wanted, false);
    return;
  }
  if (original === null) return;
  // Keep the record: YouTube's in-memory copy on open pages still holds MonoTube's bits.
  writeThemeBits(original);
  keepThemeBits(original, true);
}

// ── module ───────────────────────────────────────────────────────────────────────────────────

export function createThemeModule(): FeatureModule {
  /** Last state synced to YouTube's preference ("dark" | "light" | "off"); null before init. */
  let synced: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  /** Bumped on every change, so a queued sync can tell that a newer one follows it. */
  let generation = 0;

  return {
    name: 'theme',
    update(ctx: ModuleContext) {
      ctx.ui.setTheme(ctx.theme);
      const { enabled } = ctx.features;
      const key = enabled ? ctx.theme : 'off';
      if (synced === null) {
        synced = key; // boot alignment already happened in prepareYouTubeTheme()
        return;
      }
      if (key === synced) return;
      synced = key;
      // Stop keeping the old bits right away, before another tab handling the same change writes
      // the new ones; syncLive() starts keeping whatever this state needs.
      stopKeeping();
      const gen = ++generation;
      const { theme } = ctx;
      chain = chain
        .then(() => syncLive(enabled, theme, () => gen === generation))
        .catch((err) => console.warn('[MonoTube] theme sync failed', err));
    },
    destroy() {
      synced = null;
      generation++;
      stopKeeping();
    },
  };
}

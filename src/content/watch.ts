/**
 * Watch page module.
 *
 *  - Disable autoplay: switches YouTube's own Autoplay toggle off once per video (and again when
 *    the setting is switched on), and records in chrome.storage that MonoTube did so. When the
 *    feature is off (setting off, MonoTube disabled, "Restore original YouTube") the toggle is
 *    switched back on once and the record removed. Belt and braces: if an up-next countdown still
 *    appears when a video ends, it is cancelled.
 *    Every decision uses the toggle's settled state (see watch-autoplay.ts): YouTube first draws a
 *    placeholder "on" and applies the saved preference about a second after playback starts. The
 *    record is only written for a change MonoTube's own click made, and only removed once the
 *    restored "on" has held long enough for YouTube to persist it (a reload right after "Restore
 *    original YouTube" still finds the record and restores on the next load).
 *  - Block recommendations: a YouTube Mix (list=RD..., start_radio=1, an endless algorithmic queue
 *    that most music search results now open) is reopened as the plain video. Outside playlists,
 *    YouTube's Shift+N "next video" shortcut is swallowed (page.css hides the Next button; the
 *    shortcut would still jump to a recommendation).
 *  - Layout: asks the player to re-measure whenever its box changes (the sidebar column collapses
 *    or returns, e.g. when a transcript or chapters panel opens), see watch-player-size.ts.
 *
 * YouTube keeps the same player (and the same Autoplay toggle element) across SPA navigations, so
 * per-video work is keyed by video id and every pending wait is aborted when the video changes.
 * The toggle reflects a global YouTube preference: MonoTube enforces it once per video and does not
 * fight a user who deliberately switches it back on mid-video.
 */

import { getWatchId, isMixWatch, isPlaylistWatch, plainWatchPath } from '../shared/navigation';
import { queryFirst, SEL } from '../shared/selectors';
import { waitForElement } from './dom-observer';
import { isRendered, waitForAttribute } from './element-state';
import type { FeatureModule, ModuleContext, ModuleDeps } from './types';
import { isTypingTarget } from './ui/dom';
import {
  AUTONAV_STATE,
  autoplayStaysOn,
  inMainPlayer,
  readAutoplayState,
  setTouched,
  settledAutoplayState,
  switchAutoplay,
  wasTouched,
} from './watch-autoplay';
import { createPlayerSizeWatch } from './watch-player-size';
import { nudgeLayout } from './youtube';

const AUTONAV_CANCEL = inMainPlayer(SEL.autonavCancel);
const COUNTDOWN_OVERLAY = inMainPlayer(SEL.autonavCountdown);

/** How long to wait for the player's control bar (and its Autoplay toggle) to exist. */
const TOGGLE_WAIT_MS = 20_000;
/** Restore rounds per video: YouTube may put a stale saved "off" back once after a click. */
const RESTORE_ROUNDS = 3;
/** When to look for the up-next countdown after a video ended. */
const COUNTDOWN_CHECKS_MS = [250, 1_000, 2_500];
/** sessionStorage (youtube.com, per tab) note of the last Mix redirect, to stop redirect loops. */
const MIX_REDIRECT_KEY = 'monotube:mixRedirect';
/** A second redirect of the same Mix URL this soon after the first is treated as a loop. */
const MIX_LOOP_WINDOW_MS = 5_000;

type AutoplayJob = 'enforce' | 'restore';

function isAdOrUnstarted(player: Element): boolean {
  const c = player.classList;
  return c.contains('ad-showing') || c.contains('ad-interrupting') || c.contains('unstarted-mode');
}

/**
 * Resolve once the main player is playing the video itself: before that (unstarted, or an ad is
 * showing) the toggle does not react to clicks and YouTube has not applied the saved preference.
 */
function waitForContentPlayback(signal: AbortSignal): Promise<boolean> {
  const player = queryFirst(SEL.player);
  if (!player) return Promise.resolve(!signal.aborted);
  return waitForAttribute(player, ['class'], () => !isAdOrUnstarted(player), { signal });
}

/** True when `href` was redirected away from very recently in this tab (a redirect loop). */
function recentlyRedirected(href: string): boolean {
  try {
    const raw = sessionStorage.getItem(MIX_REDIRECT_KEY);
    const prev = raw ? (JSON.parse(raw) as { from?: unknown; at?: unknown }) : null;
    return !!prev && prev.from === href && typeof prev.at === 'number' && Date.now() - prev.at < MIX_LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function noteRedirect(href: string): void {
  try {
    sessionStorage.setItem(MIX_REDIRECT_KEY, JSON.stringify({ from: href, at: Date.now() }));
  } catch {
    /* storage blocked: the in-page guard still applies */
  }
}

export function createWatchModule(_deps: ModuleDeps): FeatureModule {
  /** True while on a watch page. */
  let onWatchPage = false;
  /** Video id of the watch page we are on (null when unknown or not on a watch page). */
  let videoId: string | null = null;
  /** The running/finished autoplay job ("enforce:<id>" | "restore:<id>"), aborted on change. */
  let job: { key: string; abort: AbortController } | null = null;
  /** Video for which the toggle was confirmed off (by us or already); used to respect user overrides. */
  let confirmedOffFor: string | null = null;
  /** features.recommendations seen on the previous update (null before the first one). */
  let prevRecs: boolean | null = null;
  /** Whether the current watch page belongs to a playlist (the sidebar shows it). */
  let inPlaylist = false;
  let shortcutBlocked = false;
  let endedWatched = false;
  let countdownTimers: number[] = [];
  /** Mix URL this document already asked to leave (location.replace is pending). */
  let mixRedirectFrom: string | null = null;
  const playerSize = createPlayerSizeWatch();

  // ── Mix ───────────────────────────────────────────────────────────────────────────────────

  /** Reopen a Mix as the plain video. Returns true when the page is being replaced. */
  function leaveMix(url: URL): boolean {
    const href = url.href;
    if (mixRedirectFrom === href) return true;
    const path = plainWatchPath(url);
    if (!path) return false;
    const target = new URL(path, url.origin).href;
    if (target === href || recentlyRedirected(href)) return false;
    mixRedirectFrom = href;
    noteRedirect(href);
    // replace(): Back must not return to the Mix URL (it would only redirect again).
    location.replace(target);
    return true;
  }

  // ── Autoplay ───────────────────────────────────────────────────────────────────────────────

  async function enforceOff(id: string, signal: AbortSignal): Promise<void> {
    const state = await waitForElement(AUTONAV_STATE, { timeout: TOGGLE_WAIT_MS, signal });
    if (!state || !(await waitForContentPlayback(signal)) || signal.aborted) return;
    const settled = await settledAutoplayState(signal);
    if (settled === null) return;
    if (settled === 'true') {
      const result = await switchAutoplay('false', signal);
      if (result === 'failed') return;
      // Only a change MonoTube's own click made is MonoTube's to undo later.
      if (result === 'switched') setTouched(true);
    }
    confirmedOffFor = id;
  }

  async function restoreOn(signal: AbortSignal): Promise<void> {
    if (!(await wasTouched()) || signal.aborted) return;
    const state = await waitForElement(AUTONAV_STATE, { timeout: TOGGLE_WAIT_MS, signal });
    if (!state || !(await waitForContentPlayback(signal)) || signal.aborted) return;
    for (let round = 0; round < RESTORE_ROUNDS && !signal.aborted; round++) {
      const settled = await settledAutoplayState(signal);
      if (settled === null) return;
      let clickedAt: number | null = null;
      if (settled === 'false') {
        const before = performance.now();
        const result = await switchAutoplay('true', signal);
        // Keep the record if the toggle could not be switched; the next watch page tries again.
        if (result === 'failed') return;
        if (result === 'switched') clickedAt = before;
      }
      // Keep the record until "on" has been persisted by YouTube: a page reloaded (or closed) in
      // the meantime must still find it and restore again.
      if (await autoplayStaysOn(clickedAt, signal)) {
        setTouched(false);
        return;
      }
      // YouTube put "off" back (a stale saved state): settle and switch again.
    }
  }

  /** Start the job this page needs, once per video and per feature state. */
  function syncAutoplayJob(kind: AutoplayJob | null): void {
    const key = kind && videoId ? `${kind}:${videoId}` : null;
    if (job?.key === key) return;
    job?.abort.abort();
    job = null;
    confirmedOffFor = null;
    if (!key || !kind || !videoId) return;
    const abort = new AbortController();
    job = { key, abort };
    const run = kind === 'enforce' ? enforceOff(videoId, abort.signal) : restoreOn(abort.signal);
    run.catch((err: unknown) => console.warn('[MonoTube] autoplay sync failed', err));
  }

  function clearCountdownTimers(): void {
    for (const t of countdownTimers) clearTimeout(t);
    countdownTimers = [];
  }

  /** Cancel YouTube's up-next countdown unless the user deliberately switched Autoplay back on. */
  function cancelCountdown(): boolean {
    const userReenabled = confirmedOffFor !== null && confirmedOffFor === videoId && readAutoplayState() === 'true';
    if (userReenabled) return true;
    const overlay = queryFirst(COUNTDOWN_OVERLAY);
    if (!overlay || !isRendered(overlay)) return false;
    queryFirst<HTMLElement>(AUTONAV_CANCEL)?.click();
    return true;
  }

  // 'ended' does not bubble, but a capture listener on document still receives it, so the listener
  // survives YouTube swapping the <video> element.
  const onEnded = (e: Event) => {
    const player = queryFirst(SEL.player);
    if (!player || !(e.target instanceof Node) || !player.contains(e.target)) return;
    if (player.classList.contains('ad-showing')) return; // an ad finished, not the video
    clearCountdownTimers();
    for (const delay of COUNTDOWN_CHECKS_MS) {
      countdownTimers.push(
        window.setTimeout(() => {
          if (cancelCountdown()) clearCountdownTimers();
        }, delay),
      );
    }
  };

  function setEndedWatch(on: boolean): void {
    if (on === endedWatched) return;
    endedWatched = on;
    if (on) document.addEventListener('ended', onEnded, true);
    else {
      document.removeEventListener('ended', onEnded, true);
      clearCountdownTimers();
    }
  }

  // ── Shift+N ────────────────────────────────────────────────────────────────────────────────

  // Window capture runs before YouTube's own document-level hotkey listeners (verified Nov 2026).
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    // keyCode 78 also covers non-Latin keyboard layouts, where YouTube still maps the key to N.
    if (e.key !== 'N' && e.key !== 'n' && e.keyCode !== 78) return;
    if (isTypingTarget(e.composedPath()[0] ?? e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  function setShortcutBlock(on: boolean): void {
    if (on === shortcutBlocked) return;
    shortcutBlocked = on;
    if (on) window.addEventListener('keydown', onKeyDown, true);
    else window.removeEventListener('keydown', onKeyDown, true);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────

  function leaveVideo(): void {
    syncAutoplayJob(null);
    clearCountdownTimers();
    videoId = null;
  }

  function leaveWatchPage(): void {
    onWatchPage = false;
    inPlaylist = false;
    leaveVideo();
    setEndedWatch(false);
    setShortcutBlock(false);
    playerSize.stop();
  }

  return {
    name: 'watch',

    update(ctx: ModuleContext) {
      const f = ctx.features;
      const onWatch = ctx.route.page === 'watch';
      const recsChanged = prevRecs !== null && prevRecs !== f.recommendations;
      prevRecs = f.recommendations;

      // A Mix is a recommendation feed, not a playlist the user chose: open the plain video.
      if (onWatch && f.recommendations && isMixWatch(ctx.route.url) && leaveMix(ctx.route.url)) {
        leaveWatchPage();
        return;
      }
      if (!onWatch) {
        leaveWatchPage();
        return;
      }

      const id = getWatchId(ctx.route.url);
      const entering = !onWatchPage;
      const playlist = isPlaylistWatch(ctx.route.url);
      const playlistChanged = playlist !== inPlaylist;
      onWatchPage = true;
      inPlaylist = playlist;
      if (id !== videoId) {
        leaveVideo();
        videoId = id;
      }
      // The sidebar column collapses/returns with these changes; the player must re-measure. Any
      // other change of the player's box (side panels opening, live chat) is caught by playerSize.
      if (entering || playlistChanged || (ctx.reason === 'settings' && recsChanged)) nudgeLayout();
      playerSize.sync();

      syncAutoplayJob(f.autoplay ? 'enforce' : 'restore');
      // In playlists, advancing to the next item is the user's choice: leave the countdown alone.
      setEndedWatch(f.autoplay && !playlist);
      setShortcutBlock(f.recommendations && !playlist);
    },

    destroy() {
      leaveWatchPage();
      prevRecs = null;
    },
  };
}

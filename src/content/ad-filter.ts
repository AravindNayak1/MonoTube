/**
 * In-stream video ad handling (part of "Ad and tracker filtering").
 *
 * Network rules and page.css block or hide most ads. Ads that still reach the player are handled
 * here without fighting YouTube: while the player carries `ad-showing` / `ad-interrupting`, its
 * video is muted and played at 16× (page.css covers the picture with a calm notice), and a visible
 * Skip button is clicked. When the ad break ends, the original mute state and speed are restored.
 *
 * Deliberately never seeks (server-side-inserted ads share the content timeline, so seeking could
 * skip real content or stall playback), never removes ad elements and never touches the network.
 *
 * One AdSession per YouTube player element: the main watch player (#movie_player, which also
 * follows the user into the miniplayer on other pages) and a channel page's trailer player.
 */

import { queryAll, SEL } from '../shared/selectors';
import { observeAttributes, waitForElement } from './dom-observer';
import { isRendered } from './element-state';
import type { FeatureModule, ModuleContext, ModuleDeps } from './types';

/** <html> attribute: number of ad breaks handled during this page load (read by the end-to-end tests). */
const HANDLED_ATTR = 'data-mt-ads-handled';
const AD_CLASSES = ['ad-showing', 'ad-interrupting'] as const;
const MEDIA_EVENTS = ['loadedmetadata', 'playing', 'ratechange'] as const;
/** Fastest first; Chrome accepts up to 16×, other engines may throw for high values. */
const FAST_RATES = [16, 8, 4, 2] as const;
const POLL_MS = 250;
/** A visible Skip button is clicked at most this often (YouTube may ignore synthetic clicks). */
const SKIP_RETRY_MS = 1_000;
/** Ads in a pod may briefly drop the ad class between them; count the pod as one break. */
const BREAK_SETTLE_MS = 750;
/** Upper bound on event-driven speed corrections per break (guards against a ratechange tug-of-war). */
const MAX_RATE_CORRECTIONS = 50;
const PLAYER_WAIT_MS = 15_000;
/** A channel page's trailer player is a separate player inside the channel's browse page. */
const CHANNEL_PLAYER = [
  ...SEL.player.map((sel) => `ytd-browse[page-subtype="channels"] ${sel}`),
  ...SEL.player.map((sel) => `ytd-channel-video-player-renderer ${sel}`),
];

interface SavedMedia {
  muted: boolean;
  rate: number;
  /** The fast rate MonoTube applied (null if every candidate was rejected). */
  forcedRate: number | null;
}

/** Set the fastest playback rate the media element accepts, starting at `from`. */
function applyFastRate(video: HTMLVideoElement, from: number | null): number | null {
  for (const rate of FAST_RATES) {
    if (from !== null && rate > from) continue;
    try {
      if (video.playbackRate !== rate) video.playbackRate = rate;
      return rate;
    } catch {
      /* NotSupportedError for this rate: try a slower one */
    }
  }
  return null;
}

// #movie_player doubles as YouTube's player API object, whose own addEventListener (player events)
// shadows the DOM method in the page's world. Always use the DOM methods directly.
const listen = EventTarget.prototype.addEventListener;
const unlisten = EventTarget.prototype.removeEventListener;

class AdSession {
  private readonly stopObserving: () => void;
  private inAd = false;
  private poll = 0;
  private settleTimer = 0;
  private corrections = 0;
  private readonly saved = new Map<HTMLVideoElement, SavedMedia>();
  /** When each Skip button was last clicked during this break. */
  private skipClicks = new WeakMap<Element, number>();

  constructor(
    readonly player: HTMLElement,
    private readonly onBreakHandled: () => void,
  ) {
    this.stopObserving = observeAttributes(player, ['class'], () => this.sync());
    this.sync();
  }

  private adShowing(): boolean {
    return AD_CLASSES.some((c) => this.player.classList.contains(c));
  }

  private sync(): void {
    const ad = this.adShowing();
    if (ad && !this.inAd) this.begin();
    else if (!ad && this.inAd) this.end();
  }

  private begin(): void {
    this.inAd = true;
    if (this.settleTimer) {
      // The previous ad of the same pod just ended: still the same break.
      clearTimeout(this.settleTimer);
      this.settleTimer = 0;
    } else {
      this.corrections = 0;
    }
    // Media events do not bubble; capturing on the player also covers a replaced <video>.
    for (const type of MEDIA_EVENTS) listen.call(this.player, type, this.onMedia, true);
    this.poll = window.setInterval(this.tick, POLL_MS);
    this.tick();
  }

  /** Stop handling and put every touched video back the way it was. */
  private stopHandling(): void {
    this.inAd = false;
    for (const type of MEDIA_EVENTS) unlisten.call(this.player, type, this.onMedia, true);
    clearInterval(this.poll);
    this.poll = 0;
    for (const [video, s] of this.saved) {
      try {
        // Only undo MonoTube's own change: if YouTube already set another speed, keep it.
        if (s.forcedRate !== null && video.playbackRate === s.forcedRate) video.playbackRate = s.rate;
        if (!s.muted && video.muted) video.muted = false;
      } catch {
        /* element gone or rate rejected: nothing left to restore */
      }
    }
    this.saved.clear();
    this.skipClicks = new WeakMap();
  }

  private end(): void {
    this.stopHandling();
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = 0;
      this.onBreakHandled();
    }, BREAK_SETTLE_MS);
  }

  /**
   * Keep a video muted and fast while the ad shows, remembering its original state the first time.
   * Writes only when a value differs, so re-applying is cheap and never loops on our own events.
   * (Verified Nov 2026: YouTube re-applies its own volume and speed whenever it loads the next ad.)
   */
  private enforce(video: HTMLVideoElement): void {
    let s = this.saved.get(video);
    if (!s) {
      s = { muted: video.muted, rate: video.playbackRate, forcedRate: null };
      this.saved.set(video, s);
    }
    try {
      if (!video.muted) video.muted = true;
    } catch {
      /* ignore */
    }
    s.forcedRate = applyFastRate(video, s.forcedRate);
  }

  private readonly onMedia = (e: Event) => {
    const video = e.target;
    if (!(video instanceof HTMLVideoElement) || !this.inAd || !this.adShowing()) return;
    if (e.type === 'ratechange') {
      // Our own write fires ratechange too; only react when someone else changed the speed.
      const s = this.saved.get(video);
      if (s && s.forcedRate !== null && video.playbackRate === s.forcedRate) return;
      if (this.corrections++ >= MAX_RATE_CORRECTIONS) return;
    }
    this.enforce(video);
  };

  private readonly tick = () => {
    if (!this.adShowing()) return this.sync();
    // Also picks up a <video> element YouTube swapped in mid-break.
    for (const video of this.player.querySelectorAll('video')) this.enforce(video);
    const now = Date.now();
    for (const button of queryAll<HTMLElement>(SEL.skipAd, this.player)) {
      if (!isRendered(button) || now - (this.skipClicks.get(button) ?? 0) < SKIP_RETRY_MS) continue;
      this.skipClicks.set(button, now);
      button.click();
      break;
    }
  };

  dispose(): void {
    this.stopObserving();
    if (this.inAd) this.stopHandling();
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = 0;
      this.onBreakHandled(); // that break did finish
    }
  }
}

export function createAdFilterModule(_deps: ModuleDeps): FeatureModule {
  const html = document.documentElement;
  const sessions = new Map<HTMLElement, AdSession>();
  let handled = 0;
  let active = false;
  let wait: { key: string; abort: AbortController } | null = null;

  const writeCounter = () => {
    const value = String(handled);
    if (html.getAttribute(HANDLED_ATTR) !== value) html.setAttribute(HANDLED_ATTR, value);
  };

  const onBreakHandled = () => {
    handled += 1;
    if (active) writeCounter();
  };

  /** Attach to every player in the document; drop sessions whose player YouTube removed. */
  function syncSessions(): void {
    for (const [player, session] of sessions) {
      if (!player.isConnected) {
        session.dispose();
        sessions.delete(player);
      }
    }
    for (const player of queryAll(SEL.player)) {
      if (!sessions.has(player)) sessions.set(player, new AdSession(player, onBreakHandled));
    }
  }

  /** On pages that create a player, wait for it once per route. */
  function syncWait(key: string | null, selectors: readonly string[] | null): void {
    if (wait?.key === key) return;
    wait?.abort.abort();
    wait = null;
    if (!key || !selectors) return;
    const abort = new AbortController();
    wait = { key, abort };
    void waitForElement(selectors, { timeout: PLAYER_WAIT_MS, signal: abort.signal }).then((player) => {
      if (player && active && !abort.signal.aborted) syncSessions();
    });
  }

  function deactivate(): void {
    active = false;
    syncWait(null, null);
    for (const session of sessions.values()) session.dispose();
    sessions.clear();
    if (html.hasAttribute(HANDLED_ATTR)) html.removeAttribute(HANDLED_ATTR);
  }

  return {
    name: 'ad-filter',

    update(ctx: ModuleContext) {
      if (!ctx.features.ads) return deactivate();
      active = true;
      writeCounter();
      // Players that already exist keep being handled on every page: the watch player continues
      // in YouTube's miniplayer while the user browses elsewhere.
      syncSessions();
      const { page, href } = ctx.route;
      if (page === 'watch') syncWait(href, SEL.player);
      else if (page === 'channel') syncWait(href, CHANNEL_PLAYER);
      else syncWait(null, null);
    },

    destroy() {
      deactivate();
    },
  };
}

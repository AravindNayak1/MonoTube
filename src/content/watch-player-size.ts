/**
 * Keeps YouTube's player measured to its box while on a watch page.
 *
 * YouTube sizes the <video> and the control bar from the window size and only re-measures on a
 * window "resize". With "Block recommendations" on, page.css collapses the sidebar column, so the
 * player's box changes whenever that column comes back or goes away again (a transcript, chapters
 * or description panel opens or closes, live chat, playlists). Without a re-measure the video is
 * cropped and the right-hand controls (CC, settings, fullscreen) end up outside the player.
 *
 * A ResizeObserver on #movie_player asks the player to re-measure (nudgeLayout) whenever the
 * observed size actually changed: at most once per frame, never for the first observation, and
 * with a loop guard. The player's outer box is set by CSS, so the re-measure does not feed back.
 */

import { queryFirst, SEL } from '../shared/selectors';
import { waitForElement } from './dom-observer';
import { nudgeLayout } from './youtube';

const PLAYER_WAIT_MS = 20_000;
/** Safety net against a feedback loop with a future player that sizes its own box on resize. */
const MAX_NUDGES_PER_SECOND = 8;

export interface PlayerSizeWatch {
  /** Observe the current main player (re-attaches when YouTube replaced it). Idempotent. */
  sync(): void;
  /** Stop observing and drop every pending wait. */
  stop(): void;
}

export function createPlayerSizeWatch(): PlayerSizeWatch {
  let ro: ResizeObserver | null = null;
  let target: Element | null = null;
  /** Last observed non-empty size of `target` ("WxH"), null before the first observation. */
  let lastSize: string | null = null;
  let wait: AbortController | null = null;
  let nudgeQueued = false;
  let windowStart = 0;
  let nudges = 0;

  function queueNudge(): void {
    if (nudgeQueued) return;
    const now = performance.now();
    if (now - windowStart > 1_000) {
      windowStart = now;
      nudges = 0;
    }
    if (++nudges > MAX_NUDGES_PER_SECOND) return;
    nudgeQueued = true;
    // Both callbacks run in the next frame, this one first: one re-measure per frame at most.
    requestAnimationFrame(() => {
      nudgeQueued = false;
    });
    nudgeLayout();
  }

  const onResize = (entries: ResizeObserverEntry[]) => {
    const el = target;
    if (!el) return;
    if (!el.isConnected) {
      sync(); // YouTube replaced the player: follow the new one
      return;
    }
    let entry: ResizeObserverEntry | undefined;
    for (const e of entries) if (e.target === el) entry = e;
    if (!entry) return;
    const width = Math.round(entry.contentRect.width);
    const height = Math.round(entry.contentRect.height);
    if (!width || !height) return; // not rendered right now (e.g. hidden): nothing to measure
    const size = `${width}x${height}`;
    if (size === lastSize) return;
    const first = lastSize === null;
    lastSize = size;
    if (!first) queueNudge();
  };

  function attach(el: Element): void {
    target = el;
    lastSize = null;
    ro ??= new ResizeObserver(onResize);
    ro.observe(el);
  }

  function detach(): void {
    wait?.abort();
    wait = null;
    if (ro && target) ro.unobserve(target);
    target = null;
    lastSize = null;
  }

  function sync(): void {
    const el = queryFirst(SEL.player);
    if (el && el === target && el.isConnected) return;
    if (!el && wait) return; // already waiting for the player
    detach();
    if (el) return attach(el);
    const ctrl = new AbortController();
    wait = ctrl;
    void waitForElement(SEL.player, { timeout: PLAYER_WAIT_MS, signal: ctrl.signal }).then((found) => {
      if (ctrl.signal.aborted || wait !== ctrl) return;
      wait = null;
      if (found) attach(found);
    });
  }

  function stop(): void {
    detach();
    ro?.disconnect();
    ro = null;
  }

  return { sync, stop };
}

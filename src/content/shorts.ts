/**
 * Shorts module: intercepts the Shorts player.
 *
 * Direct page loads of /shorts/<id> are redirected by the Shorts DNR ruleset to /?mt_shorts=<id>
 * (handled by the homepage overlay). This module covers what DNR cannot see:
 *
 *  - "page": an in-app (SPA) navigation to /shorts/<id>. page.css hides ytd-app there; this
 *    module shows a notice on an opaque backdrop and keeps every Shorts <video> paused.
 *  - "redirect": the DNR redirect landed on /?mt_shorts=<id> while the MonoTube homepage overlay
 *    is NOT showing (recommendation blocking is off), so nobody else explains it.
 *
 * Both modes offer "Watch as a regular video" (/watch?v=<id>), so the user's intent is honoured
 * without the endless feed.
 */

import { ATTR, SHORTS_PARAM } from '../shared/constants';
import { getShortsId, watchPath } from '../shared/navigation';
import { queryAll, SEL } from '../shared/selectors';
import type { FeatureModule, ModuleContext, ModuleDeps } from './types';
import type { UiRoot } from './ui/root';
import { ICONS } from './ui/dom';
import { createNotice, type Notice } from './ui/notice';
import { navigateTo } from './youtube';

type Mode = 'page' | 'redirect';

/** Containers of Shorts media (a playing <video> inside one of these gets paused). */
const SHORTS_SCOPE = 'ytd-shorts, ytd-reel-video-renderer';

const COPY = {
  title: 'Shorts are blocked',
  page: 'MonoTube keeps you out of the endless Shorts feed.',
  redirect: 'That link opened a Short. Watch it as a regular video instead.',
} as const;

export function createShortsModule(deps: ModuleDeps): FeatureModule {
  const html = document.documentElement;
  let mode: Mode | null = null;
  let notice: Notice | null = null;
  /** Video id behind the current Short (null while YouTube resolves bare /shorts). */
  let videoId: string | null = null;
  let guarding = false;

  // ── Notice ───────────────────────────────────────────────────────────────────────────────

  /** Render the notice for `next` unless it is already showing. Returns true when (re)built. */
  function showNotice(ui: UiRoot, next: Mode): boolean {
    if (mode === next && notice) return false;
    removeNotice();
    mode = next;
    notice = createNotice(ui, {
      variant: 'page',
      testId: 'mt-shorts-notice',
      title: COPY.title,
      body: COPY[next],
      escHint: next === 'page' ? 'back to search' : 'dismiss',
      actions: [
        {
          testId: 'mt-watch-anyway',
          label: 'Watch as a regular video',
          kind: 'primary',
          icon: ICONS.play,
          onSelect: () => {
            if (videoId) void navigateTo(watchPath(videoId));
          },
        },
        {
          testId: 'mt-go-search',
          label: next === 'page' ? 'Back to search' : 'Dismiss',
          kind: 'secondary',
          onSelect: leave,
        },
      ],
    });
    ui.layer('notice').append(notice.el);
    window.addEventListener('keydown', onKeydown, true);
    return true;
  }

  function removeNotice(): void {
    if (!notice) return;
    window.removeEventListener('keydown', onKeydown, true);
    notice.destroy();
    notice = null;
    mode = null;
  }

  /** "Back to search" (Shorts page) or "Dismiss" (redirect landing). */
  function leave(): void {
    if (mode === 'page') {
      void navigateTo('/');
      return;
    }
    // Shared with the homepage overlay's inline notice, so neither shows this Short again.
    if (videoId) deps.dismissBlockedShorts(videoId);
    try {
      const url = new URL(location.href);
      url.searchParams.delete(SHORTS_PARAM);
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* keep the URL; the notice still goes away */
    }
    removeNotice();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!notice) return;
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      leave();
      return;
    }
    // On the Shorts page the app is hidden: YouTube's own shortcuts (Space = play, arrows = next
    // Short) must not drive it. On the redirect landing, only isolate keys inside the notice.
    // Default actions (Tab, Enter/Space on our buttons, browser shortcuts) are unaffected.
    const target = e.composedPath()[0];
    if (mode === 'page' || (target instanceof Node && notice.el.contains(target))) e.stopImmediatePropagation();
  }

  // ── Playback guard (Shorts page only) ────────────────────────────────────────────────────

  function onPlay(e: Event): void {
    const media = e.target;
    if (media instanceof HTMLMediaElement && media.closest(SHORTS_SCOPE)) media.pause();
  }

  function startGuard(): void {
    if (!guarding) {
      guarding = true;
      // 'play' doesn't bubble, but it does go through the capture phase.
      document.addEventListener('play', onPlay, true);
    }
    for (const video of queryAll<HTMLVideoElement>(SEL.shortsVideos)) {
      if (!video.paused) video.pause();
    }
  }

  function stopGuard(): void {
    if (!guarding) return;
    guarding = false;
    document.removeEventListener('play', onPlay, true);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────────────────

  function desiredMode(ctx: ModuleContext): Mode | null {
    if (!ctx.features.shorts) return null;
    if (ctx.route.page === 'shorts') return 'page';
    if (
      ctx.route.page === 'home' &&
      // Null once the user dismissed this Short's notice (here or in the homepage overlay).
      deps.blockedShortsId(ctx.route) !== null &&
      // The homepage module (runs earlier) shows its own inline notice inside the overlay.
      !html.hasAttribute(ATTR.overlay)
    ) {
      return 'redirect';
    }
    return null;
  }

  function deactivate(): void {
    stopGuard();
    removeNotice();
    videoId = null;
  }

  return {
    name: 'shorts',

    update(ctx: ModuleContext) {
      const next = desiredMode(ctx);
      if (!next) {
        deactivate();
        return;
      }
      videoId = next === 'page' ? getShortsId(ctx.route.url) : deps.blockedShortsId(ctx.route);
      const built = showNotice(ctx.ui, next);
      notice?.setActionVisible('mt-watch-anyway', videoId !== null);
      // Keyboard users land on the first available action (after visibility is settled).
      if (built && document.hasFocus()) notice?.focusFirstAction();
      if (next === 'page') startGuard();
      else stopGuard();
    },

    destroy() {
      deactivate();
    },
  };
}

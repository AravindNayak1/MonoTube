/**
 * SPA navigation detection for YouTube.
 *
 * YouTube navigates with history.pushState and announces it with custom DOM events
 * (verified Nov 2026: yt-navigate-start / yt-page-data-updated / yt-navigate-finish fire on
 * both window and document). Those events are the primary signal; popstate, the Navigation API
 * and pageshow (bfcache) are fallbacks in case YouTube renames its events. Every signal funnels
 * into one debounced check that compares location.href, so duplicates are harmless.
 */

import { getPageType } from '../shared/navigation';
import type { Route } from './types';

export type RouteListener = (route: Route, prev: Route | null) => void;

export function routeFor(href: string): Route {
  const url = new URL(href);
  return { url, href: url.href, page: getPageType(url) };
}

export function currentRoute(): Route {
  return routeFor(location.href);
}

export interface Router {
  /** The latest known route. */
  readonly current: Route;
  /** Routes seen in this tab, most recent last (bounded). */
  readonly history: readonly Route[];
  /** Listen for "navigation is starting" (URL may not have changed yet). */
  onNavigateStart(cb: () => void): () => void;
  stop(): void;
}

const HISTORY_LIMIT = 20;

export function startRouter(onChange: RouteListener): Router {
  let current = currentRoute();
  const history: Route[] = [current];
  const startListeners = new Set<() => void>();
  let scheduled = 0;

  const check = () => {
    scheduled = 0;
    if (location.href === current.href) return;
    const prev = current;
    current = currentRoute();
    history.push(current);
    if (history.length > HISTORY_LIMIT) history.shift();
    try {
      onChange(current, prev);
    } catch (err) {
      console.warn('[MonoTube] route listener failed', err);
    }
  };

  // Coalesce bursts (YouTube fires several events per navigation) into one check.
  const schedule = () => {
    if (!scheduled) scheduled = window.setTimeout(check, 0);
  };

  const onStart = () => {
    for (const cb of startListeners) {
      try {
        cb();
      } catch (err) {
        console.warn('[MonoTube] navigate-start listener failed', err);
      }
    }
  };

  const ytEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'yt-page-type-changed'];
  for (const type of ytEvents) document.addEventListener(type, schedule, true);
  document.addEventListener('yt-navigate-start', onStart, true);
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', schedule);

  // Navigation API fallback (Chrome 102+): fires for pushState/replaceState too.
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener('currententrychange', schedule);

  return {
    get current() {
      return current;
    },
    get history() {
      return history;
    },
    onNavigateStart(cb) {
      startListeners.add(cb);
      return () => startListeners.delete(cb);
    },
    stop() {
      for (const type of ytEvents) document.removeEventListener(type, schedule, true);
      document.removeEventListener('yt-navigate-start', onStart, true);
      window.removeEventListener('popstate', schedule);
      window.removeEventListener('pageshow', schedule);
      nav?.removeEventListener('currententrychange', schedule);
      if (scheduled) clearTimeout(scheduled);
      startListeners.clear();
    },
  };
}

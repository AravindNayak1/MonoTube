/** Pure URL helpers. No DOM access, safe to unit-test and to import from any context. */

import { SHORTS_PARAM } from './constants';

export type PageType =
  | 'home' // "/" — replaced by the MonoTube homepage
  | 'explore' // trending / explore / gaming feeds — algorithmic, treated like home
  | 'search' // "/results"
  | 'watch' // "/watch"
  | 'shorts' // "/shorts/<id>"
  | 'channel' // "/@handle", "/channel/<id>", "/c/<name>", "/user/<name>"
  | 'feed' // the user's own feeds: subscriptions, history, playlists, library, "/feed/you"
  | 'other';

const EXPLORE_PATHS = new Set(['/feed/trending', '/feed/explore', '/gaming', '/feed/storefront']);

export function getPageType(url: URL): PageType {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index') return 'home';
  if (EXPLORE_PATHS.has(path)) return 'explore';
  if (path === '/results' || path === '/search') return 'search';
  if (path === '/watch') return 'watch';
  if (path === '/shorts' || path.startsWith('/shorts/')) return 'shorts';
  if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/|$)/.test(path)) return 'channel';
  if (path.startsWith('/feed/') || path === '/playlist') return 'feed';
  return 'other';
}

/** Build a YouTube search-results path for a query (YouTube's own format: spaces as "+"). */
export function buildSearchPath(query: string): string {
  const q = query.trim().replace(/\s+/g, ' ');
  return '/results?search_query=' + encodeURIComponent(q).replace(/%20/g, '+');
}

/** The search query of a /results URL, or null. */
export function getSearchQuery(url: URL): string | null {
  if (getPageType(url) !== 'search') return null;
  const q = url.searchParams.get('search_query') ?? url.searchParams.get('q');
  return q && q.trim() ? q.trim() : null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Video id of a /shorts/<id> URL, or null. */
export function getShortsId(url: URL): string | null {
  const m = /^\/shorts\/([^/?#]+)/.exec(url.pathname);
  return m && m[1] && VIDEO_ID.test(m[1]) ? m[1] : null;
}

/** Video id carried by the Shorts DNR redirect (/?mt_shorts=<id>), or null. */
export function getBlockedShortsId(url: URL): string | null {
  const id = url.searchParams.get(SHORTS_PARAM);
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Video id of a /watch URL, or null. */
export function getWatchId(url: URL): string | null {
  if (getPageType(url) !== 'watch') return null;
  const id = url.searchParams.get('v');
  return id && VIDEO_ID.test(id) ? id : null;
}

/**
 * True for watch pages inside a YouTube Mix / radio: an auto-generated, endless list of
 * recommendations (list ids starting with "RD", or start_radio=1). YouTube now links most music
 * search results this way.
 */
export function isMixWatch(url: URL): boolean {
  if (getPageType(url) !== 'watch') return false;
  const list = url.searchParams.get('list');
  return (!!list && list.startsWith('RD')) || url.searchParams.get('start_radio') === '1';
}

/**
 * True for watch pages that belong to a real playlist the user chose (Next button / auto-advance
 * are deliberate there). Mixes are recommendations, not playlists.
 */
export function isPlaylistWatch(url: URL): boolean {
  return getPageType(url) === 'watch' && !!url.searchParams.get('list') && !isMixWatch(url);
}

/** The same video without its Mix/playlist context (keeps the start time). */
export function plainWatchPath(url: URL): string | null {
  const id = getWatchId(url);
  if (!id) return null;
  const t = url.searchParams.get('t');
  return watchPath(id) + (t && /^[0-9hms]+$/.test(t) ? '&t=' + t : '');
}

/** True for a channel's Shorts tab, e.g. /@handle/shorts. */
export function isChannelShortsTab(url: URL): boolean {
  return getPageType(url) === 'channel' && /\/shorts\/?$/.test(url.pathname);
}

export function watchPath(videoId: string): string {
  return '/watch?v=' + encodeURIComponent(videoId);
}

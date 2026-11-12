/**
 * Centralized YouTube DOM selectors used from JavaScript.
 *
 * YouTube ships frequent markup changes, so every entry that matters is an ordered list of
 * fallbacks: the current (verified Nov 2026) selector first, older/alternative ones after.
 * Cosmetic hiding lives in src/content/page.css and must be kept in sync with this file.
 */

export type SelectorList = readonly string[];

export const SEL = {
  app: ['ytd-app'],
  masthead: ['ytd-masthead#masthead', 'ytd-masthead', '#masthead'],
  /** YouTube's own search input (masthead). */
  searchInput: [
    'yt-searchbox input[name="search_query"]',
    'input.ytSearchboxComponentInput',
    'input[name="search_query"]',
    'input#search',
  ],
  /** YouTube's own search submit button (masthead). */
  searchButton: [
    'button.ytSearchboxComponentSearchButton',
    'yt-searchbox button[aria-label="Search"]',
    'button#search-icon-legacy',
    '#search-icon-legacy',
  ],
  /** YouTube's logo link — clicking it performs an SPA navigation home. */
  logoLink: ['ytd-topbar-logo-renderer a#logo', 'a#logo[href="/"]'],

  // ── Watch page ────────────────────────────────────────────────────────────
  watchFlexy: ['ytd-watch-flexy'],
  player: ['#movie_player', '.html5-video-player'],
  video: ['#movie_player video.html5-main-video', '#movie_player video', 'video.html5-main-video'],
  /** The Autoplay toggle button in the player's control bar. */
  autonavToggle: ['button.ytp-autonav-toggle', '.ytp-autonav-toggle-button-container', '.ytp-autonav-toggle-button'],
  /** Element carrying the toggle state as aria-checked="true|false". */
  autonavState: ['.ytp-autonav-toggle-button[aria-checked]', 'button.ytp-autonav-toggle [aria-checked]'],
  /** "Cancel" on the up-next countdown overlay. */
  /** Up-next countdown overlay shown at the end of a video when Autoplay is on. */
  autonavCountdown: ['.ytp-autonav-endscreen-countdown-overlay'],
  autonavCancel: ['.ytp-autonav-endscreen-upnext-cancel-button', 'button.ytp-autonav-endscreen-upnext-cancel-button'],
  /** Ad skip buttons (several generations of YouTube markup). */
  skipAd: [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-slot button',
    'button[id^="skip-button"]',
  ],

  // ── Search page ───────────────────────────────────────────────────────────
  searchPage: ['ytd-search'],
  searchSectionList: ['ytd-search ytd-section-list-renderer', 'ytd-two-column-search-results-renderer ytd-section-list-renderer'],
  /** Infinite-scroll trigger at the end of the results list. */
  searchContinuation: [
    'ytd-search ytd-section-list-renderer > #contents > ytd-continuation-item-renderer',
    'ytd-search ytd-continuation-item-renderer',
  ],
  searchChips: ['ytd-search yt-chip-cloud-chip-renderer', 'ytd-search-header-renderer yt-chip-cloud-chip-renderer'],

  // ── Shorts page ───────────────────────────────────────────────────────────
  shortsPage: ['ytd-shorts'],
  shortsVideos: ['ytd-shorts video', 'ytd-reel-video-renderer video'],
} as const satisfies Record<string, SelectorList>;

/** First element matching any selector in the list (in list order). */
export function queryFirst<T extends Element = HTMLElement>(
  selectors: SelectorList | string,
  root: ParentNode = document,
): T | null {
  const list = typeof selectors === 'string' ? [selectors] : selectors;
  for (const sel of list) {
    try {
      const el = root.querySelector<T>(sel);
      if (el) return el;
    } catch {
      /* invalid selector in this engine — skip */
    }
  }
  return null;
}

/** All elements matching any selector in the list (deduplicated, document order not guaranteed). */
export function queryAll<T extends Element = HTMLElement>(
  selectors: SelectorList | string,
  root: ParentNode = document,
): T[] {
  const list = typeof selectors === 'string' ? [selectors] : selectors;
  const seen = new Set<T>();
  for (const sel of list) {
    try {
      root.querySelectorAll<T>(sel).forEach((el) => seen.add(el));
    } catch {
      /* skip */
    }
  }
  return [...seen];
}

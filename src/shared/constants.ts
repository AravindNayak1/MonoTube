/**
 * Cross-context constants shared by the content script, service worker and popup.
 * Changing a value here is a contract change: grep for usages in CSS (src/content/page.css)
 * because attribute names are also referenced from stylesheets.
 */

/** Attributes MonoTube sets on <html>. Page CSS is gated on these, so toggles apply instantly. */
export const ATTR = {
  /** Present when MonoTube is enabled. Every page rule requires it. */
  enabled: 'data-mt',
  /** Present when the "Block recommendations" feature is active (also drives homepage replacement). */
  recs: 'data-mt-recs',
  /** Present when "Block Shorts" is active. */
  shorts: 'data-mt-shorts',
  /** Present when "Hide end screens" is active (end-screen wall, end cards, info cards). */
  endscreen: 'data-mt-endscreen',
  /** Present when "Ad and tracker filtering" is active (cosmetic + video-ad handling). */
  ads: 'data-mt-ads',
  /** Present when "Hide comments" is active. */
  comments: 'data-mt-comments',
  /** Present when "Disable autoplay" is active. */
  autoplay: 'data-mt-autoplay',
  /** Current page type, see PageType in navigation.ts. Always set (even when disabled). */
  page: 'data-mt-page',
  /** Effective MonoTube theme: "dark" | "light". */
  theme: 'data-mt-theme',
  /** Present on watch pages that belong to a playlist (?list=...). */
  playlist: 'data-mt-playlist',
  /** Present while the MonoTube homepage overlay is visible. */
  overlay: 'data-mt-overlay',
  /** Present while the user asked the search page to load one more batch of results. */
  more: 'data-mt-more',
} as const;

export type AttrName = (typeof ATTR)[keyof typeof ATTR];

/** chrome.storage.local key holding the Settings object. */
export const SETTINGS_KEY = 'settings';

/**
 * chrome.storage.local key: true when MonoTube switched YouTube's own Autoplay toggle off,
 * so it can be switched back on when the user disables the feature / restores YouTube.
 */
export const AUTOPLAY_TOUCHED_KEY = 'autoplayTouchedByMonoTube';

/**
 * chrome.storage.local key: YouTube's own theme bits (PREF cookie "f6" & THEME_BITS) as they were
 * before MonoTube first changed them, restored when MonoTube is turned off.
 */
export const YOUTUBE_THEME_ORIGINAL_KEY = 'youtubeThemeBeforeMonoTube';

/** IDs of static declarativeNetRequest rulesets declared in the manifest. */
export const RULESET = {
  ads: 'ads',
  shorts: 'shorts',
} as const;

/** Runtime message types. */
export const MSG = {
  /** popup -> service worker: disable MonoTube, revert YouTube-side changes, reload YouTube tabs. */
  restore: 'monotube:restore',
} as const;

/** Reply the service worker sends for MSG.restore. */
export interface RestoreResult {
  ok: boolean;
  /** Number of YouTube tabs that were reloaded. */
  reloadedTabs?: number;
  error?: string;
}

/** chrome.commands name for the Alt+M shortcut. */
export const COMMAND_TOGGLE = 'toggle-monotube';

/** Query parameter the Shorts DNR redirect appends to the homepage URL: /?mt_shorts=<videoId>. */
export const SHORTS_PARAM = 'mt_shorts';

/** sessionStorage key (youtube.com origin, per tab) remembering the last search query. */
export const LAST_QUERY_KEY = 'monotube:lastQuery';

/** id of the Shadow DOM host element MonoTube attaches to <html>. */
export const UI_ROOT_ID = 'monotube-root';

/** id of the <style> element carrying the page stylesheet. */
export const PAGE_STYLE_ID = 'monotube-page-style';

/** Attribute placed on every DOM node MonoTube inserts into YouTube's own tree. */
export const OWN_NODE_ATTR = 'data-monotube';

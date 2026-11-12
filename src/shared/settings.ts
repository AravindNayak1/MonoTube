/** User settings model. Persisted in chrome.storage.local under SETTINGS_KEY. */

export type ThemePreference = 'dark' | 'light' | 'system';
export type EffectiveTheme = 'dark' | 'light';

export interface Settings {
  /** Master switch. When false, MonoTube leaves YouTube completely untouched. */
  enabled: boolean;
  /** Replace the home feed and hide recommendation surfaces (sidebar, shelves, guide, next button). */
  blockRecommendations: boolean;
  /** Hide Shorts everywhere and intercept /shorts/ URLs. */
  blockShorts: boolean;
  /** Keep YouTube's Autoplay (auto-advance to the next video) switched off. */
  disableAutoplay: boolean;
  /** Hide end-screen video walls, end cards and info cards inside the player. */
  hideEndScreens: boolean;
  /** Network filtering of ad/tracker requests + cosmetic ad hiding + video-ad fast-forwarding. */
  adFiltering: boolean;
  /** Hide the comments section under videos. */
  hideComments: boolean;
  /** Theme for MonoTube surfaces (also applied to YouTube's own light/dark mode). */
  theme: ThemePreference;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enabled: true,
  blockRecommendations: true,
  blockShorts: true,
  disableAutoplay: true,
  hideEndScreens: true,
  adFiltering: true,
  hideComments: false,
  theme: 'dark',
});

const BOOLEAN_KEYS = [
  'enabled',
  'blockRecommendations',
  'blockShorts',
  'disableAutoplay',
  'hideEndScreens',
  'adFiltering',
  'hideComments',
] as const satisfies readonly (keyof Settings)[];

const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system'];

/**
 * Validate an unknown value (e.g. read from storage) into a complete Settings object.
 * Unknown keys are dropped; missing or mistyped keys fall back to defaults.
 */
export function normalizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of BOOLEAN_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key];
  }
  if (typeof src.theme === 'string' && (THEMES as readonly string[]).includes(src.theme)) {
    out.theme = src.theme as ThemePreference;
  }
  return out;
}

/** Features that are actually in effect (all false when the master switch is off). */
export interface ActiveFeatures {
  enabled: boolean;
  recommendations: boolean;
  shorts: boolean;
  autoplay: boolean;
  endScreens: boolean;
  ads: boolean;
  comments: boolean;
}

export function activeFeatures(s: Settings): ActiveFeatures {
  const on = s.enabled;
  return {
    enabled: on,
    recommendations: on && s.blockRecommendations,
    shorts: on && s.blockShorts,
    autoplay: on && s.disableAutoplay,
    endScreens: on && s.hideEndScreens,
    ads: on && s.adFiltering,
    comments: on && s.hideComments,
  };
}

/** Resolve "system" against the OS preference. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): EffectiveTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

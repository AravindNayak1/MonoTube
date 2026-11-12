import { describe, expect, it } from 'vitest';
import {
  activeFeatures,
  DEFAULT_SETTINGS,
  normalizeSettings,
  resolveTheme,
  type Settings,
} from '../../src/shared/settings';

const BOOLEAN_KEYS = [
  'enabled',
  'blockRecommendations',
  'blockShorts',
  'disableAutoplay',
  'hideEndScreens',
  'adFiltering',
  'hideComments',
] as const;

describe('DEFAULT_SETTINGS', () => {
  it('is the calm-by-default product configuration', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      enabled: true,
      blockRecommendations: true,
      blockShorts: true,
      disableAutoplay: true,
      hideEndScreens: true,
      adFiltering: true,
      hideComments: false,
      theme: 'dark',
    });
  });

  it('is frozen so no caller can mutate the shared defaults', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });
});

describe('normalizeSettings', () => {
  it.each([undefined, null, 0, 42, '', 'settings', true, Symbol('x'), () => {}])(
    'returns defaults for a non-object value (%s)',
    (raw) => {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('returns defaults for an empty object and for an array', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('returns a fresh, mutable object (never the frozen defaults)', () => {
    const a = normalizeSettings(undefined);
    const b = normalizeSettings(undefined);
    expect(a).not.toBe(DEFAULT_SETTINGS);
    expect(a).not.toBe(b);
    a.enabled = false;
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
  });

  it('keeps every valid value', () => {
    const custom: Settings = {
      enabled: false,
      blockRecommendations: false,
      blockShorts: false,
      disableAutoplay: false,
      hideEndScreens: false,
      adFiltering: false,
      hideComments: true,
      theme: 'light',
    };
    expect(normalizeSettings(custom)).toEqual(custom);
  });

  it.each(BOOLEAN_KEYS)('falls back to the default for a mistyped "%s"', (key) => {
    for (const bad of ['true', 'false', 1, 0, null, {}, []]) {
      expect(normalizeSettings({ [key]: bad })[key]).toBe(DEFAULT_SETTINGS[key]);
    }
  });

  it('keeps valid keys while repairing invalid ones in the same object', () => {
    const out = normalizeSettings({ enabled: false, blockShorts: 'no', hideComments: true, theme: 42 });
    expect(out).toEqual({ ...DEFAULT_SETTINGS, enabled: false, hideComments: true });
  });

  it('drops unknown keys', () => {
    const out = normalizeSettings({ enabled: false, foo: 1, __proto__x: true, constructor: 'x' });
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(out).not.toHaveProperty('foo');
    expect(out.enabled).toBe(false);
  });

  it.each(['dark', 'light', 'system'] as const)('accepts the theme "%s"', (theme) => {
    expect(normalizeSettings({ theme }).theme).toBe(theme);
  });

  it.each(['Dark', 'LIGHT', 'auto', '', ' dark', 'blue', 1, null, true, {}])(
    'rejects the invalid theme %j',
    (theme) => {
      expect(normalizeSettings({ theme }).theme).toBe(DEFAULT_SETTINGS.theme);
    },
  );

  it('is idempotent', () => {
    const once = normalizeSettings({ enabled: false, theme: 'system', junk: 1 });
    expect(normalizeSettings(once)).toEqual(once);
  });
});

describe('activeFeatures', () => {
  it('maps each setting to its feature while MonoTube is enabled', () => {
    expect(activeFeatures({ ...DEFAULT_SETTINGS })).toEqual({
      enabled: true,
      recommendations: true,
      shorts: true,
      autoplay: true,
      endScreens: true,
      ads: true,
      comments: false,
    });
    expect(
      activeFeatures({
        ...DEFAULT_SETTINGS,
        blockRecommendations: false,
        blockShorts: false,
        disableAutoplay: false,
        hideEndScreens: false,
        adFiltering: false,
        hideComments: true,
      }),
    ).toEqual({
      enabled: true,
      recommendations: false,
      shorts: false,
      autoplay: false,
      endScreens: false,
      ads: false,
      comments: true,
    });
  });

  it('turns every feature off when the master switch is off, whatever the individual settings', () => {
    const allOn: Settings = {
      enabled: false,
      blockRecommendations: true,
      blockShorts: true,
      disableAutoplay: true,
      hideEndScreens: true,
      adFiltering: true,
      hideComments: true,
      theme: 'light',
    };
    const f = activeFeatures(allOn);
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });

  it('gates each feature individually on the master switch', () => {
    const pairs = [
      ['blockRecommendations', 'recommendations'],
      ['blockShorts', 'shorts'],
      ['disableAutoplay', 'autoplay'],
      ['hideEndScreens', 'endScreens'],
      ['adFiltering', 'ads'],
      ['hideComments', 'comments'],
    ] as const;
    for (const [setting, feature] of pairs) {
      const only: Settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(BOOLEAN_KEYS.map((k) => [k, false])) };
      only[setting] = true;
      expect(activeFeatures({ ...only, enabled: true })[feature]).toBe(true);
      expect(activeFeatures({ ...only, enabled: false })[feature]).toBe(false);
    }
  });
});

describe('resolveTheme', () => {
  it('follows the OS preference for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the OS preference for an explicit theme', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });
});

// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.youtube.com/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YOUTUBE_THEME_ORIGINAL_KEY } from '../../src/shared/constants';
import { readThemeBits, writeThemeBits } from '../../src/content/theme';
import type { ModuleContext } from '../../src/content/types';

const DARK = 0x400;
const LIGHT = 0x80000;
const RELOAD_GUARD_KEY = 'monotube:themeReload';

function setPref(value: string | null): void {
  // Expire, then (optionally) set the PREF cookie exactly as YouTube does.
  document.cookie = 'PREF=; domain=.youtube.com; path=/; max-age=0';
  if (value !== null) document.cookie = `PREF=${value}; domain=.youtube.com; path=/; secure`;
}

function pref(): string | undefined {
  return /(?:^|;\s*)PREF=([^;]*)/.exec(document.cookie)?.[1];
}

describe('YouTube PREF theme bits', () => {
  beforeEach(() => setPref(null));

  it('reads 0 when there is no PREF cookie or no f6 field', () => {
    expect(readThemeBits()).toBe(0);
    setPref('tz=Asia.Calcutta&hl=en');
    expect(readThemeBits()).toBe(0);
  });

  it('reads only the theme bits of f6', () => {
    setPref('f6=40000400&tz=UTC');
    expect(readThemeBits()).toBe(DARK);
    setPref('f6=80000');
    expect(readThemeBits()).toBe(LIGHT);
  });

  it('sets dark while preserving every other PREF field and other f6 bits', () => {
    setPref('f4=4000000&f6=40000000&tz=Asia.Calcutta&f7=100');
    writeThemeBits(DARK);
    expect(pref()).toBe('f4=4000000&f6=40000400&tz=Asia.Calcutta&f7=100');
    expect(readThemeBits()).toBe(DARK);
  });

  it('switches dark -> light (clears the other bit)', () => {
    setPref('f6=400&tz=UTC');
    writeThemeBits(LIGHT);
    expect(pref()).toBe('f6=80000&tz=UTC');
  });

  it('adds f6 when missing and removes it again when it becomes 0', () => {
    setPref('tz=UTC');
    writeThemeBits(DARK);
    expect(pref()).toBe('f6=400&tz=UTC');
    writeThemeBits(0);
    expect(pref()).toBe('tz=UTC');
  });

  it('creates the cookie when YouTube has not set one yet', () => {
    writeThemeBits(LIGHT);
    expect(pref()).toBe('f6=80000');
  });

  it('never creates an empty PREF cookie for "no theme bits"', () => {
    writeThemeBits(0);
    expect(pref()).toBeUndefined();
  });

  it('ignores stray bits passed in and never touches non-theme bits', () => {
    setPref('f6=40000000');
    writeThemeBits(0xffffffff);
    expect(pref()).toBe(`f6=${(0x40000000 | DARK | LIGHT).toString(16)}`);
  });
});

// ── boot alignment and restore ──────────────────────────────────────────────────────────────

type ThemeModule = typeof import('../../src/content/theme');

/** In-memory chrome.storage.local (+ the incognito flag) for the theme module. */
function installChrome(initial: Record<string, unknown>, incognito = false) {
  const store: Record<string, unknown> = { ...initial };
  const local = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(store, items)),
    remove: vi.fn(async (key: string) => void delete store[key]),
  };
  vi.stubGlobal('chrome', { runtime: { id: 'test' }, extension: { inIncognitoContext: incognito }, storage: { local } });
  return { store, local };
}

/**
 * A fresh copy of the theme module, evaluated with `cookie` in place (like document_start: it
 * records which theme bits YouTube's in-memory copy on this page can hold).
 */
async function loadPage(cookie: string | null): Promise<ThemeModule> {
  setPref(cookie);
  vi.resetModules();
  return import('../../src/content/theme');
}

function ctx(enabled: boolean, theme: 'dark' | 'light' = 'dark'): ModuleContext {
  return { features: { enabled }, theme, ui: { setTheme() {} } } as unknown as ModuleContext;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const reloadGuard = () => sessionStorage.getItem(RELOAD_GUARD_KEY);

describe('prepareYouTubeTheme and the theme module', () => {
  const WATCH = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  let destroy: (() => void) | null = null;

  // jsdom does not implement navigation: a reload (location.replace) only logs "Not implemented".
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    destroy?.();
    destroy = null;
  });

  it('enabled: remembers the original bits, writes MonoTube\'s and reloads once into them', async () => {
    const { store } = installChrome({});
    const theme = await loadPage('f6=80000&tz=UTC');
    expect(await theme.prepareYouTubeTheme(true, 'dark', false, WATCH)).toBe(true);
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(LIGHT);
    expect(pref()).toBe('f6=400&tz=UTC');
    expect(reloadGuard()).toBe('dark');
    // The reloaded page (rendered dark) settles and clears the guard.
    expect(await theme.prepareYouTubeTheme(true, 'dark', true, WATCH)).toBe(false);
    expect(reloadGuard()).toBeNull();
  });

  it('off, cookie still MonoTube\'s: writes the original back, keeps the record and reloads once', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: LIGHT });
    const theme = await loadPage('f6=400&tz=UTC&f5=20000');
    expect(await theme.prepareYouTubeTheme(false, 'dark', true, WATCH)).toBe(true);
    expect(pref()).toBe('f6=80000&tz=UTC&f5=20000');
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(LIGHT);
    expect(reloadGuard()).toBe('restore');
  });

  it('off, cookie already holds the original: the restore is confirmed and the record removed', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: LIGHT });
    sessionStorage.setItem(RELOAD_GUARD_KEY, 'restore'); // e.g. this is the restore reload
    const theme = await loadPage('f6=80000&tz=UTC');
    expect(await theme.prepareYouTubeTheme(false, 'dark', false, WATCH)).toBe(false);
    expect(YOUTUBE_THEME_ORIGINAL_KEY in store).toBe(false);
    expect(pref()).toBe('f6=80000&tz=UTC');
    expect(reloadGuard()).toBeNull(); // a later restore in this tab may reload again
  });

  it('off, "Device theme" original (0) but the page was rendered dark: reloads once, never loops', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: 0 });
    const theme = await loadPage('f6=400&tz=UTC');
    // The request carried MonoTube's dark bits.
    expect(await theme.prepareYouTubeTheme(false, 'dark', true, WATCH)).toBe(true);
    expect(pref()).toBe('tz=UTC');
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(0);
    // Reloaded: the cookie now holds the original. If YouTube still rendered dark, no second reload.
    expect(await theme.prepareYouTubeTheme(false, 'dark', true, WATCH)).toBe(false);
    expect(YOUTUBE_THEME_ORIGINAL_KEY in store).toBe(false);
  });

  it('off, "Device theme" original (0) already in the cookie, rendered dark: reloads once', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: 0 });
    const theme = await loadPage('tz=UTC');
    expect(await theme.prepareYouTubeTheme(false, 'dark', true, WATCH)).toBe(true);
    expect(YOUTUBE_THEME_ORIGINAL_KEY in store).toBe(false);
    expect(reloadGuard()).toBe('restore');
  });

  it('off, no record: leaves YouTube alone', async () => {
    const { local } = installChrome({});
    const theme = await loadPage('f6=400');
    expect(await theme.prepareYouTubeTheme(false, 'dark', true, WATCH)).toBe(false);
    expect(pref()).toBe('f6=400');
    expect(local.set).not.toHaveBeenCalled();
    expect(local.remove).not.toHaveBeenCalled();
  });

  it('incognito: never reads or writes PREF or the record', async () => {
    const { local } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: LIGHT }, true);
    const theme = await loadPage('f6=400');
    expect(await theme.prepareYouTubeTheme(true, 'light', true, WATCH)).toBe(false);
    expect(await theme.prepareYouTubeTheme(false, 'light', true, WATCH)).toBe(false);
    const m = theme.createThemeModule();
    destroy = () => m.destroy();
    m.update(ctx(true, 'light'));
    m.update(ctx(false, 'light'));
    await settle();
    expect(pref()).toBe('f6=400');
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
    expect(local.remove).not.toHaveBeenCalled();
  });

  it('live off: keeps the record and puts the original back after YouTube rewrites its stale copy', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: LIGHT });
    const theme = await loadPage('f6=400&tz=UTC');
    expect(await theme.prepareYouTubeTheme(true, 'dark', true, WATCH)).toBe(false);
    const m = theme.createThemeModule();
    destroy = () => m.destroy();
    m.update(ctx(true));
    m.update(ctx(false));
    await settle();
    expect(readThemeBits()).toBe(LIGHT);
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(LIGHT);

    // YouTube saves its Autoplay state by rewriting PREF from memory (still f6=400).
    setPref('f6=400&tz=UTC&f5=20000');
    window.dispatchEvent(new Event('pagehide'));
    expect(pref()).toBe('f6=80000&tz=UTC&f5=20000');
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(LIGHT);

    // The next load finds the original in place and completes the restore.
    const next = await loadPage(pref() ?? null);
    expect(await next.prepareYouTubeTheme(false, 'dark', false, WATCH)).toBe(false);
    expect(YOUTUBE_THEME_ORIGINAL_KEY in store).toBe(false);
  });

  it('live off then on again before any load: the original survives', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: LIGHT });
    const theme = await loadPage('f6=400');
    await theme.prepareYouTubeTheme(true, 'dark', true, WATCH);
    const m = theme.createThemeModule();
    destroy = () => m.destroy();
    m.update(ctx(true));
    m.update(ctx(false));
    m.update(ctx(true));
    await settle();
    expect(readThemeBits()).toBe(DARK);
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(LIGHT);
    // No restore is pending any more: leaving the page keeps MonoTube's bits.
    window.dispatchEvent(new Event('pagehide'));
    expect(readThemeBits()).toBe(DARK);
    m.update(ctx(false));
    await settle();
    expect(readThemeBits()).toBe(LIGHT);
  });

  it('live theme change while on: MonoTube\'s new bits survive YouTube rewriting its stale copy', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: 0 });
    const theme = await loadPage('f6=400&tz=UTC');
    expect(await theme.prepareYouTubeTheme(true, 'dark', true, WATCH)).toBe(false);
    const m = theme.createThemeModule();
    destroy = () => m.destroy();
    m.update(ctx(true, 'dark'));
    m.update(ctx(true, 'light'));
    await settle();
    expect(pref()).toBe('f6=80000&tz=UTC');
    // YouTube's boot saves PREF from the copy it loaded with (dark).
    setPref('f6=400&tz=UTC&f7=100');
    window.dispatchEvent(new Event('pagehide'));
    expect(pref()).toBe('f6=80000&tz=UTC&f7=100');
    expect(store[YOUTUBE_THEME_ORIGINAL_KEY]).toBe(0);
  });

  it('live off: a new appearance the user picks in YouTube replaces the original', async () => {
    const { store } = installChrome({ [YOUTUBE_THEME_ORIGINAL_KEY]: LIGHT });
    const theme = await loadPage('f6=400&tz=UTC');
    await theme.prepareYouTubeTheme(true, 'dark', true, WATCH);
    const m = theme.createThemeModule();
    destroy = () => m.destroy();
    m.update(ctx(true));
    m.update(ctx(false));
    await settle();
    // "Device theme" in YouTube's menu: a value this page's YouTube never held.
    setPref('tz=UTC');
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(pref()).toBe('tz=UTC');
    expect(YOUTUBE_THEME_ORIGINAL_KEY in store).toBe(false);
  });
});

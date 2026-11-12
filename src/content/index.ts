/**
 * MonoTube content script entry point. Runs at document_start on https://www.youtube.com/*.
 *
 * Boot sequence:
 *  1. Synchronously inject the page stylesheet and set <html> feature attributes from defaults,
 *     so recommendations/Shorts are hidden before YouTube paints anything.
 *  2. Load the real settings from chrome.storage.local, then run every feature module.
 *  3. Re-run modules on SPA navigation, settings changes (popup, Alt+M, other tabs) and OS theme
 *     changes. Modules are idempotent, so re-running is always safe.
 */

import pageCss from './page.css?inline';
import { ATTR, PAGE_STYLE_ID } from '../shared/constants';
import { getBlockedShortsId, isPlaylistWatch } from '../shared/navigation';
import { activeFeatures, DEFAULT_SETTINGS, resolveTheme, type Settings } from '../shared/settings';
import { loadSettings, onSettingsChanged } from '../shared/storage';
import { disposeDomObserver } from './dom-observer';
import { startRouter } from './router';
import { createThemeModule, prepareYouTubeTheme } from './theme';
import { createHomepageModule } from './homepage';
import { createNavModule } from './nav';
import { createSearchModule } from './search';
import { createWatchModule } from './watch';
import { createShortsModule } from './shorts';
import { createAdFilterModule } from './ad-filter';
import type { FeatureModule, ModuleContext, ModuleDeps, Route, UpdateReason } from './types';
import { createUiRoot } from './ui/root';

declare global {
  interface Window {
    __monotubeLoaded?: boolean;
  }
}

function boot(): void {
  // Guard against double injection (e.g. extension reloaded into an already-instrumented tab).
  if (window.__monotubeLoaded) return;
  window.__monotubeLoaded = true;

  const html = document.documentElement;

  const style = document.createElement('style');
  style.id = PAGE_STYLE_ID;
  style.textContent = pageCss;
  (document.head ?? html).append(style);

  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let loaded = false;
  let prevRoute: Route | null = null;
  let destroyed = false;

  const toggleAttr = (name: string, on: boolean) => {
    if (on) {
      if (!html.hasAttribute(name)) html.setAttribute(name, '');
    } else if (html.hasAttribute(name)) {
      html.removeAttribute(name);
    }
  };
  const setAttr = (name: string, value: string) => {
    if (html.getAttribute(name) !== value) html.setAttribute(name, value);
  };

  // Captured before YouTube's scripts run: YouTube rewrites the URL (dropping ?mt_shorts=) and
  // toggles its own `dark` attribute during boot.
  const landingHref = location.href;
  const landingBlockedShorts = getBlockedShortsId(new URL(landingHref));
  const renderedDark = html.hasAttribute('dark');
  let dismissedShorts: string | null = null;

  const ui = createUiRoot();
  const router = startRouter((_route, prev) => {
    prevRoute = prev;
    run('route');
  });
  const deps: ModuleDeps = {
    router,
    blockedShortsId(route) {
      if (!activeFeatures(settings).shorts) return null;
      let id = getBlockedShortsId(route.url);
      // Still on the landing page (only home routes so far, e.g. YouTube's replaceState rewrite)?
      const stillLanding = route.page === 'home' && router.history.every((r) => r.page === 'home');
      if (!id && landingBlockedShorts && stillLanding) id = landingBlockedShorts;
      return id && id !== dismissedShorts ? id : null;
    },
    dismissBlockedShorts(id) {
      dismissedShorts = id;
    },
  };

  const modules: FeatureModule[] = [
    createThemeModule(),
    createHomepageModule(deps),
    createNavModule(deps),
    createSearchModule(deps),
    createWatchModule(deps),
    createShortsModule(deps),
    createAdFilterModule(deps),
  ];

  function applyAttributes(): ModuleContext['theme'] {
    const f = activeFeatures(settings);
    const theme = resolveTheme(settings.theme, systemDark.matches);
    const route = router.current;
    toggleAttr(ATTR.enabled, f.enabled);
    toggleAttr(ATTR.recs, f.recommendations);
    toggleAttr(ATTR.shorts, f.shorts);
    toggleAttr(ATTR.endscreen, f.endScreens);
    toggleAttr(ATTR.ads, f.ads);
    toggleAttr(ATTR.comments, f.comments);
    toggleAttr(ATTR.autoplay, f.autoplay);
    toggleAttr(ATTR.playlist, isPlaylistWatch(route.url));
    setAttr(ATTR.page, route.page);
    setAttr(ATTR.theme, theme);
    return theme;
  }

  function contextValid(): boolean {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function run(reason: UpdateReason): void {
    if (destroyed) return;
    if (!contextValid()) return teardown();
    const theme = applyAttributes();
    if (!loaded) return; // modules wait for real settings; CSS already applies defaults
    ui.ensureAttached();
    const ctx: ModuleContext = {
      settings,
      features: activeFeatures(settings),
      theme,
      route: router.current,
      prevRoute,
      reason,
      ui,
    };
    for (const m of modules) {
      try {
        m.update(ctx);
      } catch (err) {
        console.warn(`[MonoTube] module "${m.name}" failed`, err);
      }
    }
  }

  /** Remove every trace of MonoTube from the page (extension disabled, updated or removed). */
  function teardown(): void {
    if (destroyed) return;
    destroyed = true;
    for (const m of modules) {
      try {
        m.destroy();
      } catch {
        /* keep tearing down */
      }
    }
    router.stop();
    disposeDomObserver();
    unsubscribe();
    systemDark.removeEventListener('change', onSystemTheme);
    style.remove();
    ui.destroy();
    for (const name of Object.values(ATTR)) html.removeAttribute(name);
    window.__monotubeLoaded = false;
  }

  const onSystemTheme = () => run('theme');
  systemDark.addEventListener('change', onSystemTheme);

  const unsubscribe = onSettingsChanged((next) => {
    settings = next;
    run('settings');
  });

  applyAttributes();
  loadSettings()
    .then(async (s) => {
      settings = s;
      const theme = resolveTheme(s.theme, systemDark.matches);
      // Align YouTube's own theme first: if that needs a reload, do it before any UI is shown.
      const reloading = await prepareYouTubeTheme(s.enabled, theme, renderedDark, landingHref).catch(() => false);
      if (reloading) return;
      loaded = true;
      run('init');
    })
    .catch((err) => console.warn('[MonoTube] boot failed', err));
}

boot();

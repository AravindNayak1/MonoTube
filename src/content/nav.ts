/**
 * Nav module: a compact MonoTube pill that replaces YouTube's logo in the masthead
 * (page.css hides the YouTube logo while MonoTube is enabled).
 *
 *   [▶ MonoTube] | [← last query]
 *
 * - "MonoTube" goes to the MonoTube homepage (SPA navigation through YouTube's own logo link).
 * - "Back to results" (shown away from the results page once the user searched in this tab)
 *   returns to the previous results page: history.back() when the tab's previous session-history
 *   entry (Navigation API) is literally that results page, otherwise a fresh genuine YouTube
 *   search for the same query.
 *
 * The pill lives in its own open shadow root on <div data-monotube="nav">, inserted into
 * ytd-masthead #start right after the guide button. If the masthead slot never appears, it
 * floats in the UiRoot "nav" layer at the same position instead.
 */

import navCss from './ui/nav.css?inline';
import { ATTR, OWN_NODE_ATTR } from '../shared/constants';
import { BRAND, themedTokensCss } from '../shared/brand';
import { getSearchQuery, type PageType } from '../shared/navigation';
import { queryFirst } from '../shared/selectors';
import type { EffectiveTheme } from '../shared/settings';
import { registerDomTask, unregisterDomTask, waitForElement } from './dom-observer';
import type { FeatureModule, ModuleContext, ModuleDeps, Route } from './types';
import type { UiRoot } from './ui/root';
import { h, icon, ICONS, logoMark } from './ui/dom';
import { lastQuery, navigateTo, rememberQuery, submitSearch } from './youtube';

/** The masthead's left section (guide button + logo). */
const START_SLOT = ['ytd-masthead #container > #start', 'ytd-masthead #start'] as const;
/** Give up waiting for the masthead slot after this long and float the pill instead. */
const MOUNT_TIMEOUT_MS = 8000;
/**
 * After mounting, watch for YouTube re-rendering the masthead (which would drop our host) for a
 * while. Later re-renders are still repaired on the next update() (every navigation).
 */
const REMOUNT_GUARD_MS = 15_000;
const GUARD_TASK = 'nav:remount';

interface NavView {
  host: HTMLDivElement;
  scope: HTMLDivElement;
  pill: HTMLElement;
  divider: HTMLSpanElement;
  back: HTMLButtonElement;
  backLabel: HTMLSpanElement;
}

export function createNavModule(_deps: ModuleDeps): FeatureModule {
  const html = document.documentElement;
  let view: NavView | null = null;
  let ui: UiRoot | null = null;
  let active = false;
  let waiting: AbortController | null = null;
  let guardTimer = 0;

  // ── View ──────────────────────────────────────────────────────────────────────────────────

  function buildView(): NavView {
    const host = h('div', { [OWN_NODE_ATTR]: 'nav' });
    const shadow = host.attachShadow({ mode: 'open' });
    const tokens = h('style');
    tokens.textContent = themedTokensCss('.mt');
    const styles = h('style');
    styles.textContent = navCss;

    const home = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--home',
        'aria-label': `${BRAND.name} home`,
        title: `${BRAND.name} home`,
        'data-testid': 'mt-nav-home',
      },
      [logoMark(22), h('span', { class: 'wordmark', 'aria-hidden': 'true' }, [BRAND.name])],
      { click: () => void navigateTo('/') },
    );
    const backLabel = h('span', { class: 'query' });
    const back = h(
      'button',
      { type: 'button', class: 'btn btn--back', 'data-testid': 'mt-nav-back' },
      [icon([...ICONS.arrowLeft], 16, 2), backLabel],
      { click: goBackToResults },
    );
    const divider = h('span', { class: 'divider', 'aria-hidden': 'true' });
    const pill = h('nav', { class: 'pill', 'aria-label': BRAND.name }, [home], {
      // Enter/Space on our buttons must not reach YouTube's global shortcuts (which only see the
      // retargeted host element, e.g. Space would toggle the player). Activation still happens.
      keydown: (e) => {
        if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
      },
    });
    const scope = h('div', { class: 'mt', 'data-theme': 'dark' }, [pill]);
    shadow.append(tokens, styles, scope);
    return { host, scope, pill, divider, back, backLabel };
  }

  function syncTheme(v: NavView, theme: EffectiveTheme): void {
    if (v.scope.getAttribute('data-theme') !== theme) v.scope.setAttribute('data-theme', theme);
  }

  function syncBack(v: NavView, page: PageType): void {
    const query = page === 'search' ? null : lastQuery();
    if (!query) {
      v.divider.remove();
      v.back.remove();
      return;
    }
    if (v.backLabel.textContent !== query) {
      v.backLabel.textContent = query;
      v.back.title = `Back to results for “${query}”`;
      v.back.setAttribute('aria-label', v.back.title);
    }
    if (!v.back.isConnected) v.pill.append(v.divider, v.back);
  }

  function goBackToResults(): void {
    const query = lastQuery();
    if (!query) return;
    const prevQuery = previousEntrySearchQuery();
    if (prevQuery !== null && sameQuery(prevQuery, query)) history.back();
    else void submitSearch(query);
  }

  // ── Mounting ─────────────────────────────────────────────────────────────────────────────

  /** Put the pill into the masthead slot if it exists, else wait for it (then fall back). */
  function mount(): void {
    if (!active || !view) return;
    const start = queryFirst(START_SLOT);
    if (start) {
      cancelWait();
      placeInMasthead(view.host, start);
      return;
    }
    if (waiting) return;
    const ctrl = new AbortController();
    waiting = ctrl;
    void waitForElement(START_SLOT, { timeout: MOUNT_TIMEOUT_MS, signal: ctrl.signal }).then((slot) => {
      if (waiting !== ctrl) return; // cancelled or superseded
      waiting = null;
      if (!active || !view) return;
      if (slot) mount();
      else if (!view.host.isConnected && ui) placeFloating(view.host, ui);
    });
  }

  function placeInMasthead(host: HTMLDivElement, start: HTMLElement): void {
    const guide = start.querySelector(':scope > #guide-button');
    const inPlace = host.parentElement === start && (guide ? host.previousElementSibling === guide : start.firstElementChild === host);
    if (host.hasAttribute('data-floating')) host.removeAttribute('data-floating');
    if (inPlace) return;
    if (guide) guide.after(host);
    else start.prepend(host);
    armRemountGuard();
  }

  function placeFloating(host: HTMLDivElement, root: UiRoot): void {
    host.setAttribute('data-floating', '');
    root.layer('nav').append(host);
  }

  function armRemountGuard(): void {
    if (guardTimer) return;
    registerDomTask(GUARD_TASK, () => {
      if (active && view && !view.host.isConnected) mount();
    });
    guardTimer = window.setTimeout(stopRemountGuard, REMOUNT_GUARD_MS);
  }

  function stopRemountGuard(): void {
    if (guardTimer) clearTimeout(guardTimer);
    guardTimer = 0;
    unregisterDomTask(GUARD_TASK);
  }

  function cancelWait(): void {
    waiting?.abort();
    waiting = null;
  }

  function unmount(): void {
    active = false;
    cancelWait();
    stopRemountGuard();
    view?.host.remove();
  }

  return {
    name: 'nav',

    update(ctx: ModuleContext) {
      ui = ctx.ui;
      if (ctx.features.enabled) rememberSearch(ctx.route);
      const wanted =
        ctx.features.enabled &&
        // The homepage module runs first and owns this attribute.
        !html.hasAttribute(ATTR.overlay) &&
        ctx.route.page !== 'shorts';
      if (!wanted) {
        unmount();
        return;
      }
      active = true;
      const v = (view ??= buildView());
      syncTheme(v, ctx.theme);
      syncBack(v, ctx.route.page);
      mount();
    },

    destroy() {
      unmount();
      view = null;
      ui = null;
    },
  };
}

/**
 * Keep "Back to results" pointing at the latest search, including searches made with YouTube's
 * own search box (submitSearch only records searches started from MonoTube).
 */
function rememberSearch(route: Route): void {
  const query = getSearchQuery(route.url);
  if (query && query !== lastQuery()) rememberQuery(query);
}

/** The slice of the Navigation API (Chrome 102+) used here; not in every TS DOM lib yet. */
interface SessionHistory {
  readonly currentEntry: { readonly index: number } | null;
  entries(): readonly { readonly url: string | null }[];
}

/**
 * Search query of the entry history.back() would land on, or null when that entry is not a
 * YouTube results page (or can't be known). This reads the tab's real back stack, not the order
 * routes were visited in: after results -> Back to the video, the previous entry is whatever came
 * before the video (possibly another site). entries() only lists this origin's contiguous entries,
 * so a cross-origin previous entry yields index 0 here and therefore null.
 */
function previousEntrySearchQuery(): string | null {
  try {
    const nav = (window as unknown as { navigation?: SessionHistory }).navigation;
    const index = nav?.currentEntry?.index ?? -1;
    if (!nav || index <= 0) return null;
    const url = nav.entries()[index - 1]?.url;
    return url ? getSearchQuery(new URL(url)) : null;
  } catch {
    return null;
  }
}

function sameQuery(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

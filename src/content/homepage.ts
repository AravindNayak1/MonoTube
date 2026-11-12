/**
 * Homepage module: replaces YouTube's algorithmic home (and explore/trending) feed with the
 * MonoTube homepage: a brand lockup, one calm visual, one search box, nothing else.
 *
 * - The overlay is built once (lazily) and attached to / detached from the UiRoot "overlay"
 *   layer as the route changes. While attached, <html data-mt-overlay> makes page.css hide
 *   ytd-app and lock page scrolling, so YouTube's own page never shows through.
 * - Searching drives YouTube's own search (submitSearch), so results are genuine YouTube
 *   results rendered by YouTube.
 * - After the Shorts DNR redirect (/?mt_shorts=<id>) an inline notice explains what happened and
 *   offers to watch the video in the regular player.
 */

import homeCss from './ui/home.css?inline';
import { ATTR, SHORTS_PARAM } from '../shared/constants';
import { BRAND } from '../shared/brand';
import { watchPath } from '../shared/navigation';
import type { FeatureModule, ModuleContext, ModuleDeps } from './types';
import type { UiRoot } from './ui/root';
import { h, icon, ICONS, isTypingTarget, logoMark } from './ui/dom';
import { createNotice, type Notice } from './ui/notice';
import { navigateTo, submitSearch } from './youtube';

const LIBRARY: readonly { label: string; path: string }[] = [
  { label: 'Subscriptions', path: '/feed/subscriptions' },
  { label: 'Watch later', path: '/playlist?list=WL' },
  { label: 'History', path: '/feed/history' },
  { label: 'Playlists', path: '/feed/playlists' },
];

/** Safety net: drop the button's pending state if no navigation took the overlay away. */
const PENDING_TIMEOUT_MS = 8000;
const WAVE_BARS = 25;

interface HomeView {
  root: HTMLDivElement;
  content: HTMLDivElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
}

export function createHomepageModule(deps: ModuleDeps): FeatureModule {
  const html = document.documentElement;
  let view: HomeView | null = null;
  let notice: Notice | null = null;
  /** Video id the current notice is about (null: no notice). */
  let noticeId: string | null = null;
  let pendingTimer = 0;

  // ── View ──────────────────────────────────────────────────────────────────────────────────

  function buildView(): HomeView {
    const input = h('input', {
      id: 'mt-home-q',
      class: 'search__input',
      type: 'search',
      placeholder: 'Search YouTube',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      'aria-describedby': 'mt-home-hints',
      'data-testid': 'mt-search-input',
    });
    const submit = h(
      'button',
      { type: 'submit', class: 'search__submit', 'aria-label': 'Search', title: 'Search', 'data-testid': 'mt-search-submit' },
      [icon([...ICONS.search], 20, 2)],
    );
    const field = h(
      'div',
      { class: 'search__field' },
      [input, h('kbd', { class: 'kbd search__hint', 'aria-hidden': 'true' }, ['/']), submit],
      {
        // Clicking anywhere on the field (padding, hint) focuses the input.
        mousedown: (e) => {
          if (e.target === field) {
            e.preventDefault();
            input.focus();
          }
        },
      },
    );
    const form = h(
      'form',
      { class: 'search', role: 'search', autocomplete: 'off', novalidate: true },
      [h('label', { class: 'sr-only', for: input.id }, ['Search YouTube']), field],
      {
        submit: (e) => {
          e.preventDefault();
          runSearch();
        },
      },
    );

    const content = h('div', { class: 'home__content' }, [
      waveform(),
      h('h1', { class: 'home__title' }, [BRAND.homeHeadline]),
      form,
      shortcutHints(),
    ]);

    const root = h(
      'div',
      { class: 'home', 'data-testid': 'mt-home' },
      [
        h('header', { class: 'home__header' }, [
          h('div', { class: 'home__brand' }, [
            logoMark(22),
            h('span', { class: 'home__wordmark' }, [BRAND.name]),
          ]),
        ]),
        h('main', { class: 'home__main' }, [content]),
        h('footer', { class: 'home__footer' }, [h('p', { class: 'home__tagline' }, [BRAND.tagline]), libraryNav()]),
      ],
    );
    return { root, content, input, submit };
  }

  function runSearch(): void {
    if (!view) return;
    const query = view.input.value.trim();
    if (!query) {
      view.input.focus();
      return;
    }
    setPending(true);
    submitSearch(query).catch((err: unknown) => {
      console.warn('[MonoTube] search failed', err);
      setPending(false);
    });
  }

  function setPending(on: boolean): void {
    clearTimeout(pendingTimer);
    pendingTimer = 0;
    if (!view) return;
    if (on) {
      view.submit.setAttribute('aria-busy', 'true');
      pendingTimer = window.setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
    } else if (view.submit.hasAttribute('aria-busy')) {
      view.submit.removeAttribute('aria-busy');
    }
  }

  // ── Shorts redirect notice ───────────────────────────────────────────────────────────────

  /**
   * `id` comes from deps.blockedShortsId(), which is already null when Shorts blocking is off or
   * the user dismissed this Short's notice (here or in the Shorts module).
   */
  function syncNotice(ui: UiRoot, v: HomeView, id: string | null): void {
    if (id === noticeId) return;
    removeNotice();
    if (!id) return;
    noticeId = id;
    notice = createNotice(ui, {
      variant: 'inline',
      testId: 'mt-shorts-notice',
      title: 'Shorts are blocked',
      body: 'That link opened a Short. Watch it as a regular video instead.',
      actions: [
        {
          testId: 'mt-watch-anyway',
          label: 'Watch as a regular video',
          kind: 'primary',
          icon: ICONS.play,
          onSelect: () => void navigateTo(watchPath(id)),
        },
        { testId: 'mt-go-search', label: 'Dismiss', kind: 'secondary', onSelect: () => dismissNotice(id) },
      ],
    });
    v.content.setAttribute('data-notice', '');
    v.content.prepend(notice.el);
  }

  function removeNotice(): void {
    notice?.destroy();
    notice = null;
    noticeId = null;
    view?.content.removeAttribute('data-notice');
  }

  /** Drop ?mt_shorts from the URL (keeping YouTube's history state) and return to the search. */
  function dismissNotice(id: string): void {
    deps.dismissBlockedShorts(id);
    try {
      const url = new URL(location.href);
      url.searchParams.delete(SHORTS_PARAM);
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* URL left as is; the shared dismissal keeps the notice hidden */
    }
    removeNotice();
    view?.input.focus({ preventScroll: true });
  }

  // ── Visibility ───────────────────────────────────────────────────────────────────────────

  function show(ui: UiRoot, v: HomeView): void {
    if (!html.hasAttribute(ATTR.overlay)) html.setAttribute(ATTR.overlay, '');
    if (v.root.isConnected) return;
    // Attribute + attach happen in the same task, so no frame shows YouTube underneath.
    ui.layer('overlay').append(v.root);
    window.addEventListener('keydown', onKeydown, true);
    pausePlayingVideos();
    if (canAutofocus()) v.input.focus({ preventScroll: true });
  }

  function hide(): void {
    if (html.hasAttribute(ATTR.overlay)) html.removeAttribute(ATTR.overlay);
    if (!view?.root.isConnected) return;
    window.removeEventListener('keydown', onKeydown, true);
    view.root.remove();
    setPending(false);
  }

  /** Autofocus only when the tab is focused and the user isn't focused on anything visible. */
  function canAutofocus(): boolean {
    if (!document.hasFocus()) return false;
    const active = document.activeElement;
    return (
      !active ||
      active === document.body ||
      active === document.documentElement ||
      // Focus left inside the now-hidden YouTube app (e.g. the nav pill that brought us home).
      active.closest('ytd-app') !== null
    );
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────────────────

  /** Window capture listener, attached only while the overlay is visible. */
  function onKeydown(e: KeyboardEvent): void {
    if (!view) return;
    // Events from our shadow root are retargeted to the host; the real target is path[0].
    const target = e.composedPath()[0] ?? null;
    const { input, root } = view;

    if (target === input && e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (input.value) input.value = '';
      else input.blur();
      return;
    }

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(target)) {
      // YouTube's own "/" handler would focus its (hidden) masthead search box.
      e.preventDefault();
      e.stopImmediatePropagation();
      input.focus({ preventScroll: true });
      input.select();
      return;
    }

    // Keys typed inside our UI must not reach YouTube's global shortcuts (which see the
    // retargeted host, not an input): typing "k" or "f" in the search box must not control a
    // player. Default actions (typing, Enter to submit, Tab) are unaffected.
    if (target instanceof Node && root.contains(target)) e.stopImmediatePropagation();
  }

  return {
    name: 'homepage',

    update(ctx: ModuleContext) {
      const { page } = ctx.route;
      const wanted = ctx.features.recommendations && (page === 'home' || page === 'explore');
      if (!wanted) {
        hide();
        removeNotice();
        return;
      }
      ctx.ui.addStyles('home', homeCss);
      const v = (view ??= buildView());
      syncNotice(ctx.ui, v, deps.blockedShortsId(ctx.route));
      show(ctx.ui, v);
    },

    destroy() {
      hide();
      removeNotice();
      clearTimeout(pendingTimer);
      view = null;
    },
  };
}

// ── Static pieces ──────────────────────────────────────────────────────────────────────────

/** Bell-shaped row of thin bars; heights/tempos are deterministic, so it looks the same each time. */
function waveform(): HTMLDivElement {
  const bars: HTMLSpanElement[] = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    const x = (i + 0.5) / WAVE_BARS;
    const envelope = Math.sin(Math.PI * x) ** 1.4; // tall centre, short edges
    const ripple = 0.72 + 0.28 * Math.abs(Math.sin(i * 2.399)); // golden-angle irregularity
    const bar = h('span', { class: 'wave__bar' });
    bar.style.setProperty('--h', (0.14 + 0.86 * envelope * ripple).toFixed(3));
    bar.style.setProperty('--o', (0.14 + 0.5 * envelope).toFixed(3));
    bar.style.setProperty('--t', `${(2.2 + ((i * 7) % 5) * 0.35).toFixed(2)}s`);
    bar.style.setProperty('--d', `${(-(i * 0.41) % 3).toFixed(2)}s`);
    bars.push(bar);
  }
  return h('div', { class: 'wave', 'aria-hidden': 'true' }, bars);
}

function kbd(label: string): HTMLElement {
  return h('kbd', { class: 'kbd' }, [label]);
}

function shortcutHints(): HTMLUListElement {
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
  const item = (keys: string[], label: string) =>
    h('li', { class: 'hints__item' }, [h('span', { class: 'hints__keys' }, keys.map(kbd)), label]);
  return h('ul', { class: 'hints', id: 'mt-home-hints', 'aria-label': 'Keyboard shortcuts' }, [
    item(['/'], 'search'),
    item(['Enter'], 'go'),
    item(['Esc'], 'clear'),
    item([isMac ? '⌥' : 'Alt', 'M'], 'toggle MonoTube'),
  ]);
}

function libraryNav(): HTMLElement {
  const links = LIBRARY.map(({ label, path }) =>
    h('a', { class: 'library__link', href: path }, [label], {
      click: (e) => {
        // Let the browser handle new-tab / new-window gestures.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void navigateTo(path);
      },
    }),
  );
  return h('nav', { class: 'library', 'aria-label': 'Your library' }, [
    h('span', { class: 'library__label' }, ['Your library']),
    ...links,
  ]);
}

/** Pause anything still playing behind the overlay (e.g. the miniplayer). Nothing else changes. */
function pausePlayingVideos(): void {
  for (const video of document.querySelectorAll('video')) {
    if (!video.paused) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
    }
  }
}

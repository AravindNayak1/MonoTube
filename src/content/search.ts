/**
 * Search page module.
 *
 *  - Remembers the current query (per tab) so MonoTube can offer "Back to results".
 *  - Deliberate pagination: page.css hides YouTube's infinite-scroll trigger (the continuation item
 *    at the end of the results list). This module renders a calm "Show more results" button after
 *    the list. Clicking it reveals the trigger (ATTR.more on <html>) for exactly one batch: YouTube
 *    loads the next page and replaces the trigger with a fresh one, and MonoTube hides it again.
 *    (Verified Nov 2026: revealing the trigger near the viewport loads the next batch and the old
 *    continuation element is removed.)
 *  - Hides the "Shorts" filter chip when Shorts are blocked.
 *
 * Everything is kept in sync by one DOM task, registered only while on a search page.
 */

import { ATTR, OWN_NODE_ATTR } from '../shared/constants';
import { themedTokensCss } from '../shared/brand';
import { getSearchQuery } from '../shared/navigation';
import { queryAll, queryFirst, SEL } from '../shared/selectors';
import type { EffectiveTheme } from '../shared/settings';
import { registerDomTask, unregisterDomTask } from './dom-observer';
import type { FeatureModule, ModuleContext, ModuleDeps } from './types';
import { h, icon, ICONS } from './ui/dom';
import moreCss from './ui/more-results.css?inline';
import { rememberQuery } from './youtube';

const TASK = 'search-more';
/** Marks YouTube elements MonoTube hid with an inline style (restored when inactive). */
const HIDDEN_ATTR = 'data-monotube-hidden';
/** If YouTube never replaces the trigger (network error, end of results), stop waiting. */
const PENDING_TIMEOUT_MS = 8_000;
const LABEL_IDLE = 'Show more results';
const LABEL_BUSY = 'Loading more results…';

interface MoreUi {
  host: HTMLDivElement;
  scope: HTMLDivElement;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  status: HTMLSpanElement;
}

interface Pending {
  /** The continuation item that was present when the user asked for more. */
  item: Element;
  /** The results list (#contents) it belongs to, and its size at that moment. */
  list: Element;
  size: number;
  timer: number;
}

/** The infinite-scroll trigger page.css hides: a direct child of the section list's #contents. */
function findTrigger(): { item: Element; list: Element } | null {
  const item = queryFirst(SEL.searchContinuation);
  const list = item?.parentElement;
  if (!item || !list || list.id !== 'contents' || list.parentElement?.localName !== 'ytd-section-list-renderer') {
    return null;
  }
  return { item, list };
}

function isShortsChip(chip: Element): boolean {
  return (chip.textContent ?? '').replace(/\s+/g, ' ').trim() === 'Shorts';
}

export function createSearchModule(_deps: ModuleDeps): FeatureModule {
  const html = document.documentElement;
  let theme: EffectiveTheme = 'dark';
  let ui: MoreUi | null = null;
  let pending: Pending | null = null;
  let wantMore = false;
  let wantChip = false;
  let taskRegistered = false;
  /** href of the search being shown; a different search starts a fresh pagination state. */
  let searchHref: string | null = null;
  /** YouTube chips MonoTube hid, with their previous inline display value. */
  const hiddenChips = new Map<HTMLElement, string>();

  // ── "Show more results" ────────────────────────────────────────────────────────────────────

  function setMoreAttr(on: boolean): void {
    if (on) {
      if (!html.hasAttribute(ATTR.more)) html.setAttribute(ATTR.more, '');
    } else if (html.hasAttribute(ATTR.more)) {
      html.removeAttribute(ATTR.more);
    }
  }

  function setBusy(busy: boolean): void {
    if (!ui) return;
    const value = String(busy);
    if (ui.button.getAttribute('aria-busy') === value) return;
    ui.button.setAttribute('aria-busy', value);
    ui.button.setAttribute('aria-disabled', value);
    ui.label.textContent = busy ? LABEL_BUSY : LABEL_IDLE;
  }

  function announce(message: string): void {
    if (!ui) return;
    const status = ui.status;
    // Clear first so an identical message is announced again.
    status.textContent = '';
    window.setTimeout(() => {
      status.textContent = message;
    }, 50);
  }

  /** End the "one more batch" request; `loaded` when new results actually arrived. */
  function finishPending(loaded: boolean): void {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    setMoreAttr(false);
    setBusy(false);
    if (loaded) announce('More results loaded');
  }

  function requestMore(): void {
    if (pending) return;
    const trigger = findTrigger();
    if (!trigger) return;
    pending = {
      item: trigger.item,
      list: trigger.list,
      size: trigger.list.childElementCount,
      timer: window.setTimeout(() => finishPending(false), PENDING_TIMEOUT_MS),
    };
    setBusy(true);
    // Reveals the trigger right above this button; YouTube fetches the next batch once it sees it.
    setMoreAttr(true);
    // YouTube only reacts to a trigger inside the viewport. After a batch loads, keyboard focus stays
    // on this button while it moves far below the fold; bring it (and the trigger) back into view.
    ui?.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function buildUi(): MoreUi {
    const host = h('div', { [OWN_NODE_ATTR]: 'more-results' });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = `${themedTokensCss('.mt')}\n${moreCss}`;
    const label = h('span', { class: 'label' }, [LABEL_IDLE]);
    const button = h(
      'button',
      { type: 'button', class: 'more', 'data-testid': 'mt-more-results', 'aria-busy': 'false' },
      [h('span', { class: 'spinner', 'aria-hidden': 'true' }), label, icon([...ICONS.chevronDown], 16)],
      { click: requestMore },
    );
    const status = h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const scope = h('div', { class: 'mt', 'data-theme': theme }, [h('div', { class: 'row' }, [button]), status]);
    shadow.append(style, scope);
    return { host, scope, button, label, status };
  }

  function removeMoreUi(): void {
    finishPending(false);
    setMoreAttr(false);
    ui?.host.remove();
    ui = null;
  }

  function syncMore(): void {
    const trigger = findTrigger();
    if (pending) {
      const p = pending;
      const replaced = !p.item.isConnected || trigger?.item !== p.item || p.list.childElementCount !== p.size;
      if (replaced) finishPending(true);
    }
    if (!trigger) {
      // No (more) results to load: keep the control out of sight.
      if (ui && ui.host.style.display !== 'none') ui.host.style.display = 'none';
      return;
    }
    ui ??= buildUi();
    const { host } = ui;
    if (host.previousElementSibling !== trigger.list) trigger.list.after(host);
    if (host.style.display === 'none') host.style.removeProperty('display');
  }

  // ── Shorts chip ────────────────────────────────────────────────────────────────────────────

  function unhideChip(chip: HTMLElement, display: string): void {
    chip.style.display = display;
    chip.removeAttribute(HIDDEN_ATTR);
  }

  function restoreChips(): void {
    for (const [chip, display] of hiddenChips) unhideChip(chip, display);
    hiddenChips.clear();
  }

  function syncChips(): void {
    // YouTube re-uses chip elements: un-hide one that no longer says "Shorts".
    for (const [chip, display] of hiddenChips) {
      if (!chip.isConnected || !isShortsChip(chip)) {
        unhideChip(chip, display);
        hiddenChips.delete(chip);
      }
    }
    for (const chip of queryAll(SEL.searchChips)) {
      if (hiddenChips.has(chip) || !isShortsChip(chip)) continue;
      hiddenChips.set(chip, chip.style.display);
      chip.style.display = 'none';
      chip.setAttribute(HIDDEN_ATTR, '');
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────

  function sync(): void {
    if (wantMore) syncMore();
    if (wantChip) syncChips();
  }

  function stopTask(): void {
    if (!taskRegistered) return;
    taskRegistered = false;
    unregisterDomTask(TASK);
  }

  function teardown(): void {
    wantMore = false;
    wantChip = false;
    searchHref = null;
    stopTask();
    removeMoreUi();
    restoreChips();
  }

  return {
    name: 'search',

    update(ctx: ModuleContext) {
      theme = ctx.theme;
      if (ui && ui.scope.getAttribute('data-theme') !== theme) ui.scope.setAttribute('data-theme', theme);

      const onSearch = ctx.route.page === 'search' && ctx.features.enabled;
      if (!onSearch) return teardown();

      const query = getSearchQuery(ctx.route.url);
      if (query) rememberQuery(query);

      // A new query or filter: any outstanding "load more" belonged to the previous results.
      if (searchHref !== ctx.route.href) finishPending(false);
      searchHref = ctx.route.href;

      wantMore = ctx.features.recommendations;
      wantChip = ctx.features.shorts;
      if (!wantMore) removeMoreUi();
      if (!wantChip) restoreChips();

      if (!wantMore && !wantChip) return stopTask();
      if (taskRegistered) {
        sync(); // settings/theme changed while the page itself is unchanged
      } else {
        taskRegistered = true;
        registerDomTask(TASK, sync); // runs once right away, then after DOM changes
      }
    },

    destroy() {
      teardown();
    },
  };
}

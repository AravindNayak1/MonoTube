/**
 * The single Shadow DOM host for all MonoTube UI injected into YouTube.
 *
 * <div id="monotube-root"> is attached to <html> (it exists at document_start, <body> may not),
 * with an open shadow root so styles are fully isolated from YouTube and vice versa.
 * Inside the shadow root:
 *
 *   <style data-key="base">            tokens + base reset
 *   <style data-key="...">             one per module (addStyles)
 *   <div class="mt" data-theme="dark|light">
 *     <div data-layer="overlay">       homepage overlay (full screen)
 *     <div data-layer="nav">           floating MonoTube navigation pill
 *     <div data-layer="notice">        centred notices (e.g. Shorts blocked)
 *     <div data-layer="toast">         transient messages
 *
 * Layers are position:fixed and pointer-events:none; interactive children opt back in with
 * pointer-events:auto. Fixed layers live outside YouTube's fullscreen element, so they are
 * automatically covered while the player is fullscreen.
 */

import { UI_ROOT_ID } from '../../shared/constants';
import { themedTokensCss } from '../../shared/brand';
import type { EffectiveTheme } from '../../shared/settings';
import { h } from './dom';

export type LayerName = 'overlay' | 'nav' | 'notice' | 'toast';

export interface UiRoot {
  readonly host: HTMLDivElement;
  readonly shadow: ShadowRoot;
  /** Themed wrapper (carries data-theme); layers are its children. */
  readonly themeScope: HTMLDivElement;
  /** Get (creating once) a named fixed layer. */
  layer(name: LayerName): HTMLDivElement;
  /** Add a stylesheet to the shadow root once per key (later calls with the same key are no-ops). */
  addStyles(key: string, css: string): void;
  setTheme(theme: EffectiveTheme): void;
  /** Re-attach the host if something removed it from the document. */
  ensureAttached(): void;
  /** Remove the host entirely. */
  destroy(): void;
}

const LAYER_ORDER: LayerName[] = ['overlay', 'nav', 'notice', 'toast'];

const BASE_CSS = `
${themedTokensCss('.mt')}
:host { all: initial; }
.mt {
  font-family: var(--mt-font);
  color: var(--mt-text);
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
:where(.mt) *, :where(.mt) *::before, :where(.mt) *::after { box-sizing: border-box; }
.mt [hidden] { display: none !important; }
:where(.mt) button { font: inherit; color: inherit; }
[data-layer] { position: fixed; pointer-events: none; }
[data-layer]:empty { display: none; }
[data-layer="overlay"] { inset: 0; }
[data-layer="nav"] { top: 0; left: 0; }
[data-layer="notice"] { inset: 0; }
[data-layer="toast"] { left: 0; right: 0; bottom: 24px; display: flex; justify-content: center; }
.mt :focus-visible { outline: 2px solid var(--mt-focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .mt *, .mt *::before, .mt *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
`;

export function createUiRoot(): UiRoot {
  const host = h('div', { id: UI_ROOT_ID });
  // Inline styles beat any page stylesheet targeting the host element itself.
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('top', '0', 'important');
  host.style.setProperty('left', '0', 'important');
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('z-index', '2147483000', 'important');
  host.style.setProperty('display', 'block', 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const styles = new Map<string, HTMLStyleElement>();
  const themeScope = h('div', { class: 'mt', 'data-theme': 'dark' });
  const layers = new Map<LayerName, HTMLDivElement>();

  const addStyles = (key: string, css: string) => {
    if (styles.has(key)) return;
    const el = h('style', { 'data-key': key });
    el.textContent = css;
    // Keep all <style> elements before the theme scope.
    shadow.insertBefore(el, themeScope.parentNode === shadow ? themeScope : null);
    styles.set(key, el);
  };

  addStyles('base', BASE_CSS);
  shadow.append(themeScope);

  const layer = (name: LayerName): HTMLDivElement => {
    let el = layers.get(name);
    if (el) return el;
    el = h('div', { 'data-layer': name });
    layers.set(name, el);
    // Insert respecting the stacking order.
    const after = LAYER_ORDER.slice(LAYER_ORDER.indexOf(name) + 1)
      .map((n) => layers.get(n))
      .find((n): n is HTMLDivElement => !!n && n.parentNode === themeScope);
    themeScope.insertBefore(el, after ?? null);
    return el;
  };

  const ensureAttached = () => {
    if (!host.isConnected) document.documentElement.append(host);
  };

  ensureAttached();

  return {
    host,
    shadow,
    themeScope,
    layer,
    addStyles,
    setTheme(theme) {
      if (themeScope.getAttribute('data-theme') !== theme) themeScope.setAttribute('data-theme', theme);
    },
    ensureAttached,
    destroy() {
      host.remove();
    },
  };
}

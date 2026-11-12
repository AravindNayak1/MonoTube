/**
 * Tiny DOM builders for content-script UI.
 *
 * YouTube enforces Trusted Types, so content scripts must never assign HTML strings
 * (innerHTML, outerHTML, insertAdjacentHTML, DOMParser). Build nodes with these helpers instead.
 */

import { LOGO, LOGO_MARK_PATH } from '../../shared/brand';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;
type Events = { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };

/** Create an HTML element. Boolean true => empty attribute, false/null/undefined => omitted. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
  on: Events = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  for (const [type, fn] of Object.entries(on)) {
    if (fn) el.addEventListener(type, fn as EventListener);
  }
  return el;
}

/** Create an SVG element. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

function setAttrs(el: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** Remove all children of an element. */
export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

/** The monochrome MonoTube mark (squircle with play cut-out), coloured by `currentColor`. */
export function logoMark(size = 24, title?: string): SVGSVGElement {
  return s(
    'svg',
    {
      viewBox: LOGO.viewBox,
      width: size,
      height: size,
      fill: 'currentColor',
      'aria-hidden': title ? null : 'true',
      role: title ? 'img' : null,
      focusable: 'false',
    },
    [title ? s('title', {}, [title]) : null, s('path', { d: LOGO_MARK_PATH, 'fill-rule': 'evenodd' })],
  );
}

/** Generic stroke icon on a 24×24 grid (Lucide-style geometry). */
export function icon(paths: readonly string[], size = 20, strokeWidth = 1.75): SVGSVGElement {
  return s(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    paths.map((d) => s('path', { d })),
  );
}

export const ICONS = {
  search: ['M21 21l-4.35-4.35', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z'],
  arrowLeft: ['M19 12H5', 'M12 19l-7-7 7-7'],
  arrowRight: ['M5 12h14', 'M12 5l7 7-7 7'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  play: ['M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z'],
  chevronDown: ['M6 9l6 6 6-6'],
} as const;

/** True when the event target is a text-entry control (shortcuts must not fire there). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) {
    const t = target.type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(t);
  }
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target as HTMLElement).isContentEditable === true
  );
}

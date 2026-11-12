/**
 * Small helpers for reading the state of individual YouTube elements.
 *
 * Waiting on a single element's attributes goes through observeAttributes (dom-observer.ts), the
 * sanctioned targeted observer, so no extra document-wide MutationObserver is ever created.
 */

import { observeAttributes } from './dom-observer';

/** True when the element currently produces layout boxes, i.e. is actually shown on the page. */
export function isRendered(el: Element): boolean {
  return (el instanceof HTMLElement && el.offsetParent !== null) || el.getClientRects().length > 0;
}

/**
 * Resolve true as soon as `predicate()` holds, re-checking whenever one of `attributes` changes on
 * `el`. Resolves false after `timeout` ms (when given) or when `signal` aborts.
 */
export function waitForAttribute(
  el: Element,
  attributes: string[],
  predicate: () => boolean,
  { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  if (predicate()) return Promise.resolve(true);
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      stop();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const stop = observeAttributes(el, attributes, () => {
      if (predicate()) finish(true);
    });
    if (timeout !== undefined) timer = window.setTimeout(() => finish(false), timeout);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

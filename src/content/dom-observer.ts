/**
 * Shared, lifecycle-managed DOM observation.
 *
 * Most of MonoTube's hiding is pure CSS (see page.css), so JavaScript rarely needs to watch the
 * DOM. When it does, it goes through this module, which guarantees:
 *
 *  - ONE MutationObserver for the whole extension, connected only while at least one task or
 *    waiter is registered, disconnected as soon as none are (no idle cost).
 *  - Debouncing: mutation bursts are coalesced into a single pass per animation frame, so tasks
 *    run at most ~60×/s however noisy YouTube is, and usually far less. Hidden tabs get no
 *    animation frames, so there the pass runs on a short timer instead (background tabs must
 *    still mute ads and switch Autoplay off).
 *  - No feedback loops: mutation records that only touch nodes MonoTube inserted
 *    (marked with OWN_NODE_ATTR) are ignored, and tasks must be idempotent.
 *  - Targeted attribute observers (observeAttributes) for single elements such as the player.
 */

import { OWN_NODE_ATTR } from '../shared/constants';
import { queryFirst, type SelectorList } from '../shared/selectors';

type Task = () => void;

const tasks = new Map<string, Task>();
const waiters = new Set<() => boolean>();
let observer: MutationObserver | null = null;
let frame = 0;
let fallback = 0;
const HIDDEN_FLUSH_MS = 50;

function isOwnNode(node: Node): boolean {
  return node instanceof Element && (node.hasAttribute(OWN_NODE_ATTR) || node.closest(`[${OWN_NODE_ATTR}]`) !== null);
}

function relevant(records: MutationRecord[]): boolean {
  for (const r of records) {
    if (isOwnNode(r.target)) continue;
    for (const n of r.addedNodes) if (!isOwnNode(n)) return true;
    for (const n of r.removedNodes) if (!isOwnNode(n)) return true;
  }
  return false;
}

function flush(): void {
  if (frame) cancelAnimationFrame(frame);
  if (fallback) clearTimeout(fallback);
  frame = 0;
  fallback = 0;
  for (const w of [...waiters]) {
    try {
      if (w()) waiters.delete(w);
    } catch {
      waiters.delete(w);
    }
  }
  for (const [name, task] of tasks) {
    try {
      task();
    } catch (err) {
      console.warn(`[MonoTube] DOM task "${name}" failed`, err);
    }
  }
  syncConnection();
}

function schedule(): void {
  if (frame || fallback) return;
  if (document.hidden) fallback = window.setTimeout(flush, HIDDEN_FLUSH_MS);
  else frame = requestAnimationFrame(flush);
}

function syncConnection(): void {
  const needed = tasks.size > 0 || waiters.size > 0;
  if (needed && !observer) {
    observer = new MutationObserver((records) => {
      if (relevant(records)) schedule();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else if (!needed && observer) {
    observer.disconnect();
    observer = null;
    if (frame) cancelAnimationFrame(frame);
    if (fallback) clearTimeout(fallback);
    frame = 0;
    fallback = 0;
  }
}

/**
 * Run `task` after DOM changes (debounced to one call per frame) and once right away.
 * Registering the same name again replaces the previous task. Returns an unregister function.
 */
export function registerDomTask(name: string, task: Task): () => void {
  tasks.set(name, task);
  syncConnection();
  schedule();
  return () => unregisterDomTask(name);
}

export function unregisterDomTask(name: string): void {
  tasks.delete(name);
  syncConnection();
}

/**
 * Resolve with the first element matching `selectors` once it exists, or null after `timeout` ms
 * or when `signal` aborts. Resolves immediately if it already exists.
 */
export function waitForElement<T extends Element = HTMLElement>(
  selectors: SelectorList | string,
  { timeout = 10_000, signal }: { timeout?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
  const existing = queryFirst<T>(selectors);
  if (existing) return Promise.resolve(existing);
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    let timer = 0;
    const done = (value: T | null) => {
      waiters.delete(check);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      syncConnection();
      resolve(value);
    };
    const check = (): boolean => {
      const el = queryFirst<T>(selectors);
      if (el) {
        // Resolve asynchronously so the waiter set is not mutated mid-iteration by callers.
        queueMicrotask(() => done(el));
        return true;
      }
      return false;
    };
    const onAbort = () => done(null);
    // Last look before giving up, in case no flush ran (e.g. the tab was hidden).
    timer = window.setTimeout(() => done(queryFirst<T>(selectors)), timeout);
    signal?.addEventListener('abort', onAbort, { once: true });
    waiters.add(check);
    syncConnection();
  });
}

/**
 * Observe attribute changes on a single element (e.g. the player's class list).
 * The callback is invoked synchronously per batch of records. Returns a disconnect function.
 */
export function observeAttributes(
  el: Element,
  attributeFilter: string[],
  callback: (records: MutationRecord[]) => void,
): () => void {
  const mo = new MutationObserver(callback);
  mo.observe(el, { attributes: true, attributeFilter, attributeOldValue: true });
  return () => mo.disconnect();
}

/** Disconnect everything (used when MonoTube is torn down). */
export function disposeDomObserver(): void {
  tasks.clear();
  waiters.clear();
  syncConnection();
}

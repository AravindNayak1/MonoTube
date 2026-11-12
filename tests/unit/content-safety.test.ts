/**
 * Static guards for the content script source (src/content/**).
 *
 * The content script runs inside YouTube, which enforces Trusted Types and is extremely DOM-heavy.
 * These checks keep the two most damaging mistakes out of every module, including ones added later:
 *  - HTML-string sinks (innerHTML & co.) that throw under Trusted Types or open XSS holes;
 *  - private document-wide MutationObservers that bypass the shared, debounced observer.
 */

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('../../src/content/**/*.ts', { query: '?raw', import: 'default', eager: true });
const files = Object.entries(sources).map(([path, code]) => ({
  path: path.replace(/^(\.\.\/)+/, ''),
  // Comments may legitimately mention forbidden APIs (e.g. "never use innerHTML").
  code: code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1'),
}));

/** Foundation files allowed to construct MutationObservers (shared observer + targeted <html> attribute watch). */
const OBSERVER_OWNERS = new Set(['src/content/dom-observer.ts', 'src/content/theme.ts']);

describe('content script source', () => {
  it('includes the foundation files', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/content/index.ts');
    expect(paths).toContain('src/content/dom-observer.ts');
  });

  it.each([
    ['innerHTML/outerHTML assignment', /\.(innerHTML|outerHTML)\s*\+?=(?!=)/],
    ['insertAdjacentHTML', /\binsertAdjacentHTML\s*\(/],
    ['DOMParser', /\bDOMParser\b/],
    ['document.write', /\bdocument\s*\.\s*write(ln)?\s*\(/],
    ['createContextualFragment', /\bcreateContextualFragment\s*\(/],
    ['setHTMLUnsafe / parseHTMLUnsafe', /\b(setHTMLUnsafe|parseHTMLUnsafe)\s*\(/],
    ['srcdoc', /\.srcdoc\s*=|['"]srcdoc['"]/],
    ['eval / new Function', /\beval\s*\(|\bnew\s+Function\s*\(/],
    ['string timers', /\bset(Timeout|Interval)\s*\(\s*['"`]/],
  ])('never uses %s (Trusted Types)', (_label, pattern) => {
    const offenders = files.filter((f) => pattern.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('creates MutationObservers only through the shared dom-observer module', () => {
    const offenders = files
      .filter((f) => !OBSERVER_OWNERS.has(f.path) && /\bnew\s+MutationObserver\b/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('never imports React or other popup code into the content script', () => {
    const offenders = files.filter((f) => /from\s+['"](react|react-dom)(\/[^'"]*)?['"]|from\s+['"][./]*popup\//.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

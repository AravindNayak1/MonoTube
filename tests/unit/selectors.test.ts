// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { queryAll, queryFirst, SEL } from '../../src/shared/selectors';

/** Build a fixture tree with DOM APIs (no HTML strings, mirroring the content-script rules). */
function el(tag: string, attrs: Record<string, string> = {}, children: Element[] = []): Element {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

let first: Element;
let second: Element;
let scoped: Element;

beforeEach(() => {
  document.body.replaceChildren();
  // Document order: .legacy comes BEFORE .modern, so list order (not document order) must win.
  first = el('div', { class: 'legacy', id: 'a' });
  second = el('div', { class: 'modern', id: 'b' });
  scoped = el('section', { id: 'scope' }, [el('span', { class: 'inner' })]);
  document.body.append(first, second, scoped, el('span', { class: 'inner', id: 'outside' }));
});

describe('queryFirst', () => {
  it('honours the order of the fallback list, not document order', () => {
    expect(queryFirst(['.modern', '.legacy'])).toBe(second);
    expect(queryFirst(['.legacy', '.modern'])).toBe(first);
  });

  it('falls back to later selectors when earlier ones match nothing', () => {
    expect(queryFirst(['.does-not-exist', 'ytd-nothing', '.modern'])).toBe(second);
  });

  it('accepts a single selector string', () => {
    expect(queryFirst('#b')).toBe(second);
  });

  it('returns null when nothing matches', () => {
    expect(queryFirst(['.nope', '#missing'])).toBeNull();
    expect(queryFirst([])).toBeNull();
  });

  it('skips selectors the engine cannot parse instead of throwing', () => {
    const invalid = ['[[broken', 'div:::nope', '>>>'];
    expect(() => queryFirst(invalid)).not.toThrow();
    expect(queryFirst(invalid)).toBeNull();
    expect(queryFirst(['[[broken', '.modern'])).toBe(second);
    expect(queryFirst('div:::nope')).toBeNull();
  });

  it('searches inside the given root only', () => {
    const inner = queryFirst('.inner', scoped);
    expect(inner).not.toBeNull();
    expect(inner?.closest('#scope')).toBe(scoped);
    expect(queryFirst('#a', scoped)).toBeNull();
  });

  it('works with a shadow root as the search root', () => {
    const host = el('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const target = el('button', { 'data-testid': 'x' });
    shadow.append(target);
    expect(queryFirst('[data-testid="x"]', shadow)).toBe(target);
    expect(queryFirst('[data-testid="x"]')).toBeNull(); // document queries do not pierce
  });
});

describe('queryAll', () => {
  it('collects matches from every selector in the list', () => {
    const found = queryAll(['.legacy', '.modern']);
    expect(found).toHaveLength(2);
    expect(found).toEqual(expect.arrayContaining([first, second]));
  });

  it('deduplicates elements matched by several selectors', () => {
    const found = queryAll(['div', '#a', '.legacy', 'body > div']);
    expect(found).toHaveLength(2);
    expect(new Set(found).size).toBe(found.length);
  });

  it('tolerates invalid selectors', () => {
    expect(() => queryAll(['[[broken', '.modern'])).not.toThrow();
    expect(queryAll(['[[broken', '.modern'])).toEqual([second]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(queryAll(['.nope'])).toEqual([]);
    expect(queryAll('.nope')).toEqual([]);
  });

  it('respects the root', () => {
    expect(queryAll('.inner', scoped)).toHaveLength(1);
    expect(queryAll('.inner')).toHaveLength(2);
  });
});

describe('SEL', () => {
  it('every entry is a non-empty list of distinct, parseable selectors', () => {
    for (const [name, list] of Object.entries(SEL)) {
      expect(list.length, name).toBeGreaterThan(0);
      expect(new Set(list).size, `${name} has duplicates`).toBe(list.length);
      for (const sel of list) {
        expect(() => document.querySelector(sel), `${name}: ${sel}`).not.toThrow();
      }
    }
  });

  it('finds YouTube\'s masthead search controls in their verified Nov 2026 markup', () => {
    const input = el('input', { class: 'ytSearchboxComponentInput', name: 'search_query' });
    const button = el('button', { class: 'ytSearchboxComponentSearchButton', 'aria-label': 'Search' });
    const form = el('form', { class: 'ytSearchboxComponentSearchForm', action: '/results' }, [input]);
    document.body.append(el('ytd-masthead', { id: 'masthead' }, [el('yt-searchbox', {}, [form, button])]));
    expect(queryFirst(SEL.searchInput)).toBe(input);
    expect(queryFirst(SEL.searchButton)).toBe(button);
    expect(queryFirst(SEL.masthead)?.id).toBe('masthead');
  });

  it('finds the autoplay toggle state element', () => {
    const state = el('div', { class: 'ytp-autonav-toggle-button', 'aria-checked': 'true' });
    const button = el('button', { class: 'ytp-button ytp-autonav-toggle', 'aria-label': 'Autoplay is on' }, [
      el('div', { class: 'ytp-autonav-toggle-button-container' }, [state]),
    ]);
    document.body.append(el('div', { id: 'movie_player', class: 'html5-video-player' }, [button]));
    expect(queryFirst(SEL.autonavToggle)).toBe(button);
    expect(queryFirst(SEL.autonavState)).toBe(state);
    expect(queryFirst(SEL.player)?.id).toBe('movie_player');
  });
});

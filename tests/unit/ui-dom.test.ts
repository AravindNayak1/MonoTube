// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LOGO, LOGO_MARK_PATH } from '../../src/shared/brand';
import { clear, h, icon, ICONS, isTypingTarget, logoMark, s } from '../../src/content/ui/dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('h()', () => {
  it('creates the requested HTML element', () => {
    const el = h('section');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.tagName).toBe('SECTION');
    expect(el.childNodes).toHaveLength(0);
    expect(el.attributes).toHaveLength(0);
  });

  it('serialises attributes: true -> empty, false/null/undefined -> omitted, numbers -> strings', () => {
    const el = h('input', {
      id: 'q',
      'data-testid': 'mt-search-input',
      tabindex: 0,
      maxlength: 120,
      required: true,
      disabled: false,
      title: null,
      placeholder: undefined,
      'aria-label': 'Search YouTube',
    });
    expect(el.getAttribute('id')).toBe('q');
    expect(el.getAttribute('data-testid')).toBe('mt-search-input');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('maxlength')).toBe('120');
    expect(el.getAttribute('required')).toBe('');
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('placeholder')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Search YouTube');
  });

  it('appends strings as text nodes and skips null/undefined/false children, keeping order', () => {
    const span = h('span', {}, ['inner']);
    const el = h('p', {}, ['Hello ', null, span, undefined, false, '!']);
    expect(el.childNodes).toHaveLength(3);
    expect(el.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(el.childNodes[1]).toBe(span);
    expect(el.textContent).toBe('Hello inner!');
  });

  it('treats strings as text, never as markup', () => {
    const el = h('div', {}, ['<img src=x onerror=alert(1)>']);
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('wires event listeners', () => {
    const onClick = vi.fn();
    const onKeydown = vi.fn();
    const el = h('button', { type: 'button' }, ['Go'], { click: onClick, keydown: onKeydown });
    el.click();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
    expect(onKeydown).toHaveBeenCalledTimes(1);
    expect((onKeydown.mock.calls[0]?.[0] as KeyboardEvent).key).toBe('Enter');
  });

  it('ignores undefined handlers', () => {
    expect(() => h('button', {}, [], { click: undefined }).click()).not.toThrow();
  });
});

describe('s()', () => {
  it('creates namespaced SVG elements with case-preserved attributes', () => {
    const path = s('path', { d: 'M0 0L1 1', 'stroke-width': 2 });
    const svg = s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: false }, [path, null]);
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(path.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.hasAttribute('focusable')).toBe(false);
    expect(path.getAttribute('stroke-width')).toBe('2');
    expect(svg.childNodes).toHaveLength(1);
    expect(svg.firstChild).toBe(path);
  });
});

describe('clear()', () => {
  it('removes every child node', () => {
    const el = h('div', {}, ['text', h('span'), h('b', {}, ['x'])]);
    clear(el);
    expect(el.childNodes).toHaveLength(0);
    expect(() => clear(el)).not.toThrow();
  });
});

describe('logoMark()', () => {
  it('returns a decorative svg with the single evenodd mark path', () => {
    const svg = logoMark(32);
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.getAttribute('viewBox')).toBe(LOGO.viewBox);
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('role')).toBe(false);
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill-rule')).toBe('evenodd');
    expect(paths[0]?.getAttribute('d')).toBe(LOGO_MARK_PATH);
    expect(svg.querySelector('title')).toBeNull();
  });

  it('defaults to 24px', () => {
    expect(logoMark().getAttribute('width')).toBe('24');
  });

  it('becomes an accessible image when given a title', () => {
    const svg = logoMark(24, 'MonoTube');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
    expect(svg.querySelector('title')?.textContent).toBe('MonoTube');
    expect(svg.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('the mark path combines the squircle and the play cut-out', () => {
    expect(LOGO_MARK_PATH.startsWith(LOGO.squircle)).toBe(true);
    expect(LOGO_MARK_PATH.endsWith(LOGO.play)).toBe(true);
  });
});

describe('icon()', () => {
  it('draws one stroked path per segment on a 24px grid', () => {
    const svg = icon([...ICONS.search], 18);
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const ds = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    expect(ds).toEqual([...ICONS.search]);
  });

  it('every built-in icon has at least one path', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
    }
  });
});

describe('isTypingTarget()', () => {
  it.each(['text', 'search', 'email', 'url', 'password', 'number', 'tel'])('is true for <input type=%s>', (type) => {
    expect(isTypingTarget(h('input', { type }))).toBe(true);
  });

  it('is true for an input without a type (defaults to text)', () => {
    expect(isTypingTarget(h('input'))).toBe(true);
  });

  it.each(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'])(
    'is false for <input type=%s>',
    (type) => {
      expect(isTypingTarget(h('input', { type }))).toBe(false);
    },
  );

  it('is true for textarea and select', () => {
    expect(isTypingTarget(h('textarea'))).toBe(true);
    expect(isTypingTarget(h('select'))).toBe(true);
  });

  it('is true for contenteditable elements', () => {
    const editable = h('div', { contenteditable: 'true' });
    // jsdom does not compute isContentEditable; emulate what browsers report for this element.
    if (editable.isContentEditable === undefined) {
      Object.defineProperty(editable, 'isContentEditable', { value: true });
    }
    expect(isTypingTarget(editable)).toBe(true);
  });

  it('is false for non-editable elements and non-elements', () => {
    expect(isTypingTarget(h('div'))).toBe(false);
    expect(isTypingTarget(h('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(document)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

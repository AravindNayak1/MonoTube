/**
 * Static safety checks for src/content/page.css, the stylesheet MonoTube injects into YouTube.
 *
 * The stylesheet hides distractions with CSS only, so two properties matter above all:
 *  1. Every rule is gated on an attribute MonoTube puts on <html> (disable MonoTube => nothing matches).
 *  2. No rule ever hides the essentials: the player, its controls, the video, search, genuine results.
 */

import { describe, expect, it } from 'vitest';
import pageCss from '../../src/content/page.css?raw';
import { ATTR, OWN_NODE_ATTR } from '../../src/shared/constants';

interface CssRule {
  selectors: string[];
  declarations: string;
}

/** Split on `sep` at nesting depth 0 (outside (), [] and quotes). */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Tiny CSS rule extractor: style rules at top level and inside @media / @supports / @layer. */
function parseRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    // Find the matching close brace (quotes inside declarations, e.g. content: "…", are skipped).
    let depth = 1;
    let j = open + 1;
    let quote: string | null = null;
    for (; j < src.length && depth > 0; j++) {
      const c = src[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    const body = src.slice(open + 1, j - 1);
    if (/^@(media|supports|layer|container)\b/.test(prelude)) {
      rules.push(...parseRules(body));
    } else if (!prelude.startsWith('@')) {
      rules.push({ selectors: splitTopLevel(prelude, ','), declarations: body });
    }
    i = j;
  }
  return rules;
}

/** The last compound selector (the element the rule actually styles). */
function subjectOf(selector: string): string {
  const normalized = selector.replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 ');
  const parts = splitTopLevel(normalized, ' ').filter((p) => !/^[>+~]$/.test(p));
  return parts[parts.length - 1] ?? '';
}

/** Does the rule make its subject invisible? */
function hides(rule: CssRule): boolean {
  const d = rule.declarations.replace(/\s+/g, ' ').toLowerCase();
  return /(^|;)\s*display\s*:\s*none\b/.test(d) || /visibility\s*:\s*hidden\b/.test(d) || /(^|;)\s*opacity\s*:\s*0(\.0*)?\s*(!important)?\s*(;|$)/.test(d);
}

const rules = parseRules(pageCss);
const hidingRules = rules.filter(hides);
const allSelectors = rules.flatMap((r) => r.selectors);
const hidingSelectors = hidingRules.flatMap((r) => r.selectors);

/** Attributes that are present only while MonoTube (or one of its features) is on. */
const GATES = Object.values(ATTR).filter((a) => a !== ATTR.page && a !== ATTR.theme);

describe('page.css parser self-check', () => {
  it('parses the stylesheet into a meaningful number of rules', () => {
    expect(rules.length).toBeGreaterThan(10);
    expect(hidingRules.length).toBeGreaterThan(5);
  });

  it('keeps selector lists inside :has()/:not() intact', () => {
    expect(splitTopLevel('a:has(b, c), d:not([x="1,2"])', ',')).toEqual(['a:has(b, c)', 'd:not([x="1,2"])']);
    expect(subjectOf('html[data-mt] ytd-search > #contents > ytd-x:has(a b)')).toBe('ytd-x:has(a b)');
    expect(subjectOf('html[data-mt] #movie_player.ad-showing::after')).toBe('#movie_player.ad-showing::after');
  });
});

describe('page.css gating', () => {
  it('every selector starts with an html[data-mt…] gate', () => {
    for (const sel of allSelectors) {
      expect(sel, sel).toMatch(/^html\[data-mt/);
    }
  });

  it('every selector is gated on a presence attribute that only exists while MonoTube is on', () => {
    for (const sel of allSelectors) {
      const leading = /^html((?:\[[^\]]+\]|:not\([^)]*\))+)/.exec(sel)?.[1] ?? '';
      const presence = [...leading.matchAll(/(?<!:not\()\[([a-z-]+)\]/g)].map((m) => m[1]);
      expect(
        presence.some((a) => a !== undefined && GATES.includes(a as (typeof GATES)[number])),
        `${sel} must require one of ${GATES.join(', ')}`,
      ).toBe(true);
    }
  });

  it('only references attributes MonoTube actually sets', () => {
    const known = new Set<string>([...Object.values(ATTR), OWN_NODE_ATTR]);
    const used = new Set([...pageCss.matchAll(/\[(data-m[a-z-]*)/g)].map((m) => m[1] ?? ''));
    for (const attr of used) expect(known.has(attr), `unknown attribute ${attr}`).toBe(true);
  });

  it('hides with !important so YouTube styles cannot win', () => {
    for (const rule of hidingRules) {
      const decls = rule.declarations.split(';').filter((d) => /display\s*:\s*none|visibility\s*:\s*hidden/.test(d));
      for (const d of decls) expect(d, rule.selectors.join(', ')).toContain('!important');
    }
  });

  it('loads nothing from the network', () => {
    expect(pageCss).not.toMatch(/@import|url\s*\(/i);
  });
});

describe('page.css never hides the essentials', () => {
  /**
   * Elements that must never be hidden, whatever the state. Matched against the subject of each
   * hiding selector; pseudo-element subjects (e.g. `#movie_player.ad-showing::after`) style
   * generated content, not the element, and are skipped.
   */
  const FORBIDDEN_SUBJECTS: [string, RegExp][] = [
    ['the main <video>', /^(video|\.html5-main-video)(?![\w-])/],
    ['#movie_player itself', /^(#movie_player|\.html5-video-player)(?![\w-])/],
    ['the player controls', /\.ytp-(chrome-bottom|chrome-controls|progress-bar|play-button|left-controls|right-controls)(?![\w-])/],
    ['the player container', /^(ytd-player|#player|#player-container|#ytd-player|#container\.ytd-player)(?![\w-])/],
    ['the video title/metadata', /^(ytd-watch-metadata|#below)(?![\w-])/],
    ['YouTube search', /^(yt-searchbox|ytd-searchbox|#search|#center|input|form)(?![\w-])|\.ytSearchbox/],
    ['the masthead', /^(ytd-masthead|#masthead)(?![\w-])/],
    ['the search page', /^ytd-search(?![\w-])/],
    ['the results list', /^(ytd-two-column-search-results-renderer|ytd-section-list-renderer|#primary|#contents)(?![\w-])/],
    ['the watch page', /^(ytd-watch-flexy|#columns|ytd-page-manager|#page-manager)(?![\w-])/],
    // ytd-playlist-panel-renderer is only hidden for Mixes: see "keeps a real playlist's panel" below.
    ['the playlist panel container', /^#playlist(?![\w-])/],
    ['live chat', /^(#chat-container|#chat|ytd-live-chat-frame)(?![\w-])/],
    ['the page itself', /^(html|body)(?![\w-])/],
  ];

  it.each(FORBIDDEN_SUBJECTS)('never hides %s', (_label, pattern) => {
    for (const sel of hidingSelectors) {
      const subject = subjectOf(sel);
      if (subject.includes('::')) continue;
      expect(pattern.test(subject), sel).toBe(false);
    }
  });

  it('never hides a genuine video result (result renderers only behind a Shorts/ad/Mix :has() guard)', () => {
    for (const sel of hidingSelectors) {
      const subject = subjectOf(sel);
      if (!/^(ytd-(video|grid-video|compact-video|rich-item)-renderer|yt-lockup-view-model)(?![\w-])/.test(subject)) continue;
      const shortsOrAd = /:has\([^)]*(\/shorts\/|ad-slot-renderer)/.test(subject);
      expect(shortsOrAd || isMixLockupGuard(subject), sel).toBe(true);
    }
  });

  /**
   * A Mix lockup is told apart from a video lockup (which may also link into a Mix: YouTube opens
   * most music results as list=RD…&start_radio=1) by its collection thumbnail, and from a real
   * playlist lockup (also a collection) by its list=RD… link.
   */
  function isMixLockupGuard(subject: string): boolean {
    return (
      /^yt-lockup-view-model(?![\w-])/.test(subject) &&
      subject.includes(':has(yt-collection-thumbnail-view-model)') &&
      subject.includes(':has(a[href*="list=RD"])')
    );
  }

  it('hides Mix lockups in search results only, and never real playlists', () => {
    const mix = hidingSelectors.filter((sel) => isMixLockupGuard(subjectOf(sel)));
    expect(mix.length).toBeGreaterThan(0);
    for (const sel of mix) {
      expect(sel).toMatch(/^html\[data-mt\]\[data-mt-recs\] ytd-search /);
    }
    for (const sel of hidingSelectors) expect(sel, sel).not.toMatch(/list=(PL|WL|LL|OLAK|UU)/);
    // Every list=RD guard sits in search results, behind the recommendations gate.
    for (const sel of hidingSelectors.filter((s) => s.includes('list=RD'))) {
      expect(sel).toMatch(/^html\[data-mt\]\[data-mt-recs\] ytd-search /);
    }
  });

  it("keeps a real playlist's panel; hides the queue panel only on non-playlist (Mix) watch pages", () => {
    const panel = hidingSelectors.filter((sel) => /^ytd-playlist-panel-renderer(?![\w-])/.test(subjectOf(sel)));
    expect(panel.length).toBeGreaterThan(0);
    for (const sel of panel) {
      expect(sel).toMatch(/^html\[data-mt\]\[data-mt-recs\]/);
      expect(sel).toContain('[data-mt-page="watch"]');
      expect(sel).toContain(':not([data-mt-playlist])');
    }
  });

  it('only hides item sections that are ad-only or the watch-next recommendation feed', () => {
    for (const sel of hidingSelectors) {
      const subject = subjectOf(sel);
      if (!/^ytd-item-section-renderer(?![\w-])/.test(subject)) continue;
      expect(subject, sel).toMatch(/:has\(.*ad-slot-renderer:only-child\)|\[section-identifier="watch-next-feed"\]/);
    }
  });

  it('only hides the whole YouTube app behind the overlay or on the blocked Shorts page', () => {
    for (const sel of hidingSelectors) {
      if (!/^ytd-app(?![\w-])/.test(subjectOf(sel))) continue;
      expect(sel).toMatch(/^html\[data-mt-overlay\]|\[data-mt-page="shorts"\]/);
    }
  });

  describe('watch sidebar collapse', () => {
    const collapse = hidingSelectors.filter((sel) => /#secondary\b/.test(subjectOf(sel)));
    const gateOf = (sel: string) => /^html((?:\[[^\]]+\]|:not\([^)]*\))+)/.exec(sel)?.[1] ?? '';
    const exceptionOf = (sel: string) => /:not\(:has\(([\s\S]*)\)\)$/.exec(subjectOf(sel))?.[1] ?? '';

    it('exists, for real playlists and for everything else', () => {
      expect(collapse.some((sel) => gateOf(sel).includes(':not([data-mt-playlist])'))).toBe(true);
      expect(collapse.some((sel) => /(?<!:not\()\[data-mt-playlist\]/.test(gateOf(sel)))).toBe(true);
    });

    it('only collapses the watch sidebar when it holds nothing the user chose', () => {
      for (const sel of collapse) {
        expect(sel).toContain('data-mt-page="watch"');
        const exception = exceptionOf(sel);
        expect(exception, sel).not.toBe('');
        // A live chat that is shown keeps the column (a hidden chat-replay frame does not).
        expect(exception, sel).toContain('#chat-container ytd-live-chat-frame:not([hide-chat-frame])');
        // So does any open panel (transcript, chapters, description…).
        expect(exception, sel).toContain('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
        // So does the playlist, unless this watch page is not in a real playlist (e.g. a Mix).
        if (!exception.includes('ytd-playlist-panel-renderer')) expect(gateOf(sel), sel).toContain(':not([data-mt-playlist])');
      }
    });

    it('only discounts open panels that MonoTube itself hides, under the same gate', () => {
      for (const sel of collapse) {
        const gate = gateOf(sel);
        for (const [, op, target] of exceptionOf(sel).matchAll(/:not\(\[target-id(\^?=)"([^"]+)"\]\)/g)) {
          // e.g. :not([target-id^="shopping_panel"]) under [data-mt-ads] needs a [data-mt-ads] rule
          // hiding ytd-engagement-panel-section-list-renderer[target-id^="shopping_panel"].
          const hider = hidingSelectors.find((h) => {
            const m = /^html((?:\[[^\]]+\]|:not\([^)]*\))+)/.exec(h);
            const hGate = m?.[1] ?? '';
            const attrs = [...hGate.matchAll(/(?<!:not\()\[([a-z-]+)\]/g)].map((a) => a[1] ?? '');
            return (
              attrs.every((a) => gate.includes(`[${a}]`)) &&
              subjectOf(h) === `ytd-engagement-panel-section-list-renderer[target-id${op}"${target}"]`
            );
          });
          expect(hider, `${target} is discounted in ${sel} but not hidden under that gate`).toBeDefined();
        }
      }
    });

    it('keeps YouTube’s 16px left gutter while centring the player', () => {
      const centring = rules.filter((r) => r.selectors.some((s) => /#columns\b/.test(subjectOf(s))) && /justify-content\s*:\s*center/.test(r.declarations));
      expect(centring.length).toBeGreaterThan(0);
      for (const r of centring) expect(r.declarations).toMatch(/padding-left\s*:[^;]*16px[^;]*!important/);
    });
  });

  it('keeps the Next button inside playlists', () => {
    const next = hidingSelectors.filter((sel) => /\.ytp-next-button\b/.test(subjectOf(sel)));
    expect(next.length).toBeGreaterThan(0);
    for (const sel of next) expect(sel).toContain(':not([data-mt-playlist])');
  });

  it('hides the infinite-scroll trigger only until the user asks for more results', () => {
    const cont = hidingSelectors.filter((sel) => /ytd-continuation-item-renderer\b/.test(subjectOf(sel)));
    expect(cont.length).toBeGreaterThan(0);
    for (const sel of cont) {
      expect(sel).toContain(':not([data-mt-more])');
      expect(sel).toContain('ytd-search');
    }
  });

  it('only fades the video picture while an ad is showing', () => {
    for (const rule of hidingRules) {
      if (!/opacity\s*:\s*0/.test(rule.declarations)) continue;
      for (const sel of rule.selectors) expect(sel).toMatch(/\.ad-showing/);
    }
  });

  it('keeps end-screen hiding scoped inside the player', () => {
    for (const sel of hidingSelectors) {
      if (!/\.ytp-(ce-|endscreen|videowall|suggestion|cards|pause-overlay)/.test(subjectOf(sel))) continue;
      expect(sel).toContain('#movie_player ');
    }
  });
});

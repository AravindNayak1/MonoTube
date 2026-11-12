/**
 * declarativeNetRequest ruleset tests.
 *
 * 1. Structure: every rule in rules/*.json is something Chrome will accept and that stays scoped
 *    to YouTube (ad rules never touch other sites; the Shorts ruleset only redirects top-level
 *    navigations).
 * 2. Behaviour: a small, faithful re-implementation of the DNR matching semantics MonoTube uses
 *    (urlFilter with "||", "|", "*", "^"; regexFilter; requestDomains / initiatorDomains with
 *    subdomain matching; domainType; resource types; priorities with allow > block on ties;
 *    redirects with regexSubstitution) evaluates real request URLs against the shipped rules:
 *    playback-critical requests must survive, known ad/tracker requests must be blocked, and
 *    /shorts/<id> navigations must land on /?mt_shorts=<id>.
 *
 * Ruleset files are written by another part of the build; while one is missing its tests are
 * skipped with an explicit message rather than failing.
 */

import { describe, expect, it } from 'vitest';
import { RULESET, SHORTS_PARAM } from '../../src/shared/constants';
import { getBlockedShortsId, getPageType } from '../../src/shared/navigation';
import { manifest } from '../../src/manifest';

// ───────────────────────────── DNR model ─────────────────────────────

const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

const ACTION_TYPES = ['block', 'redirect', 'allow', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const REQUEST_METHODS = ['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other'];

const CONDITION_KEYS = new Set([
  'urlFilter',
  'regexFilter',
  'isUrlFilterCaseSensitive',
  'initiatorDomains',
  'excludedInitiatorDomains',
  'requestDomains',
  'excludedRequestDomains',
  'topDomains',
  'excludedTopDomains',
  'resourceTypes',
  'excludedResourceTypes',
  'requestMethods',
  'excludedRequestMethods',
  'domainType',
  'responseHeaders',
  'excludedResponseHeaders',
]);

interface DnrCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  resourceTypes?: ResourceType[];
  excludedResourceTypes?: ResourceType[];
  requestMethods?: string[];
  excludedRequestMethods?: string[];
  domainType?: 'firstParty' | 'thirdParty';
}

interface DnrRedirect {
  url?: string;
  extensionPath?: string;
  regexSubstitution?: string;
  transform?: unknown;
}

interface DnrRule {
  id: number;
  priority?: number;
  action: { type: ActionType; redirect?: DnrRedirect };
  condition: DnrCondition;
}

interface DnrRequest {
  url: string;
  type: ResourceType;
  /** Origin of the document that made the request; absent for browser-initiated navigations. */
  initiator?: string;
  method?: string;
}

type Verdict =
  | { action: 'none' }
  | { action: 'allow' | 'block' | 'upgradeScheme'; rule: DnrRule }
  | { action: 'redirect'; rule: DnrRule; url: string };

/** Precedence between actions of equal priority (Chrome docs: allow > allowAllRequests > block > upgradeScheme > redirect). */
const ACTION_RANK: Record<ActionType, number> = {
  allow: 5,
  allowAllRequests: 4,
  block: 3,
  upgradeScheme: 2,
  redirect: 1,
  modifyHeaders: 0,
};

const escapeRegExp = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** urlFilter -> RegExp, following Chrome's url_pattern semantics. */
function urlFilterToRegExp(filter: string, caseSensitive: boolean): RegExp {
  let f = filter;
  let prefix = '';
  let suffix = '';
  if (f.startsWith('||')) {
    // Domain anchor: the pattern starts at the beginning of the host or of one of its labels.
    prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]*\\.)?';
    f = f.slice(2);
  } else if (f.startsWith('|')) {
    prefix = '^';
    f = f.slice(1);
  }
  if (f.endsWith('|')) {
    suffix = '$';
    f = f.slice(0, -1);
  }
  const body = [...f]
    .map((c) => {
      if (c === '*') return '.*';
      // Separator: anything but a letter, digit, "_", "-", "." or "%"; also matches the end of the URL.
      if (c === '^') return '(?:[^A-Za-z0-9_\\-.%]|$)';
      return escapeRegExp(c);
    })
    .join('');
  return new RegExp(prefix + body + suffix, caseSensitive ? '' : 'i');
}

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

/** Registrable domain (eTLD+1). Every host in these tests sits under a single-label public suffix. */
const site = (host: string) => host.split('.').slice(-2).join('.');

function ruleMatches(rule: DnrRule, req: DnrRequest): boolean {
  const c = rule.condition;
  const url = new URL(req.url);
  const host = url.hostname;
  const initiatorHost = req.initiator ? new URL(req.initiator).hostname : null;
  const caseSensitive = c.isUrlFilterCaseSensitive ?? false;
  const method = (req.method ?? 'get').toLowerCase();

  // Resource type: without resourceTypes, a rule matches everything except main_frame.
  if (c.resourceTypes) {
    if (!c.resourceTypes.includes(req.type)) return false;
  } else if (c.excludedResourceTypes) {
    if (c.excludedResourceTypes.includes(req.type)) return false;
  } else if (req.type === 'main_frame') {
    return false;
  }
  if (c.requestMethods && !c.requestMethods.includes(method)) return false;
  if (c.excludedRequestMethods?.includes(method)) return false;

  if (c.requestDomains && !c.requestDomains.some((d) => hostMatches(host, d))) return false;
  if (c.excludedRequestDomains?.some((d) => hostMatches(host, d))) return false;
  if (c.initiatorDomains && !(initiatorHost && c.initiatorDomains.some((d) => hostMatches(initiatorHost, d)))) return false;
  if (initiatorHost && c.excludedInitiatorDomains?.some((d) => hostMatches(initiatorHost, d))) return false;

  if (c.domainType) {
    // A request without an initiator has an opaque first-party origin, which Chrome treats as third-party.
    const thirdParty = !initiatorHost || site(host) !== site(initiatorHost);
    if ((c.domainType === 'thirdParty') !== thirdParty) return false;
  }

  const href = url.href;
  if (c.urlFilter !== undefined && !urlFilterToRegExp(c.urlFilter, caseSensitive).test(href)) return false;
  if (c.regexFilter !== undefined && !new RegExp(c.regexFilter, caseSensitive ? '' : 'i').test(href)) return false;
  return true;
}

/** RE2-style rewrite (\0-\9 groups, \\ literal backslash) applied with replace-first semantics like RE2::Replace. */
function applyRegexSubstitution(rule: DnrRule, href: string, substitution: string): string {
  const c = rule.condition;
  const re = new RegExp(c.regexFilter ?? '', c.isUrlFilterCaseSensitive ? '' : 'i');
  const jsReplacement = substitution
    .replace(/\$/g, '$$$$')
    .replace(/\\(\d|\\)/g, (_m, d: string) => (d === '\\' ? '\\' : d === '0' ? '$&' : '$' + d));
  return href.replace(re, jsReplacement);
}

function redirectTarget(rule: DnrRule, href: string): string {
  const r = rule.action.redirect ?? {};
  if (r.url !== undefined) return r.url;
  if (r.regexSubstitution !== undefined) return applyRegexSubstitution(rule, href, r.regexSubstitution);
  throw new Error(`rule ${rule.id}: redirect kind not supported by the test matcher: ${JSON.stringify(r)}`);
}

/**
 * Decide what Chrome does with a request given every enabled rule of the extension.
 * `frameUrl` (the document the subresource belongs to) lets allowAllRequests rules matched on the
 * frame navigation apply to its subresources, as in Chrome.
 */
function evaluate(rules: DnrRule[], req: DnrRequest, frameUrl?: string): Verdict {
  type Candidate = { rule: DnrRule; type: ActionType; priority: number };
  const candidates: Candidate[] = [];
  if (frameUrl && req.type !== 'main_frame') {
    for (const rule of rules) {
      if (rule.action.type === 'allowAllRequests' && ruleMatches(rule, { url: frameUrl, type: 'main_frame' })) {
        candidates.push({ rule, type: 'allow', priority: rule.priority ?? 1 });
      }
    }
  }
  for (const rule of rules) {
    if (rule.action.type === 'modifyHeaders' || !ruleMatches(rule, req)) continue;
    const type = rule.action.type === 'allowAllRequests' ? 'allow' : rule.action.type;
    candidates.push({ rule, type, priority: rule.priority ?? 1 });
  }
  candidates.sort((a, b) => b.priority - a.priority || ACTION_RANK[b.type] - ACTION_RANK[a.type]);
  const winner = candidates[0];
  if (!winner) return { action: 'none' };
  if (winner.type === 'redirect') return { action: 'redirect', rule: winner.rule, url: redirectTarget(winner.rule, new URL(req.url).href) };
  if (winner.type === 'allow' || winner.type === 'block' || winner.type === 'upgradeScheme') {
    return { action: winner.type, rule: winner.rule };
  }
  return { action: 'none' };
}

// ───────────────────────────── Structural validation ─────────────────────────────

const isDomain = (d: unknown) => typeof d === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);

/** Returns human-readable problems (empty when the ruleset is valid). */
function validateRuleset(name: string, rules: unknown, opts: { mainFrameOnly: boolean }): string[] {
  const problems: string[] = [];
  if (!Array.isArray(rules)) return [`${name}: top level must be an array of rules`];
  if (rules.length === 0) problems.push(`${name}: ruleset is empty`);
  if (rules.length > 30_000) problems.push(`${name}: more than 30000 static rules`);
  const ids = new Set<number>();
  let regexCount = 0;

  for (const [index, raw] of rules.entries()) {
    const rule = raw as Partial<DnrRule> & Record<string, unknown>;
    const at = `${name}[${index}] (id ${String(rule?.id)})`;
    if (!rule || typeof rule !== 'object') {
      problems.push(`${at}: not an object`);
      continue;
    }
    for (const key of Object.keys(rule)) {
      if (!['id', 'priority', 'action', 'condition'].includes(key)) problems.push(`${at}: unknown rule key "${key}"`);
    }
    if (!Number.isInteger(rule.id) || (rule.id as number) < 1) problems.push(`${at}: id must be a positive integer`);
    else if (ids.has(rule.id as number)) problems.push(`${at}: duplicate id`);
    else ids.add(rule.id as number);
    if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1)) {
      problems.push(`${at}: priority must be an integer >= 1`);
    }

    const action = rule.action;
    if (!action || !ACTION_TYPES.includes(action.type)) {
      problems.push(`${at}: invalid action type ${JSON.stringify(action?.type)}`);
      continue;
    }
    const c = (rule.condition ?? {}) as DnrCondition & Record<string, unknown>;
    if (typeof rule.condition !== 'object' || rule.condition === null) problems.push(`${at}: missing condition`);
    for (const key of Object.keys(c)) {
      if (!CONDITION_KEYS.has(key)) problems.push(`${at}: unknown/deprecated condition key "${key}"`);
    }

    // Filters
    if (c.urlFilter !== undefined && c.regexFilter !== undefined) problems.push(`${at}: urlFilter and regexFilter are exclusive`);
    if (c.urlFilter !== undefined) {
      if (typeof c.urlFilter !== 'string' || !c.urlFilter || !/^[\x20-\x7e]+$/.test(c.urlFilter)) {
        problems.push(`${at}: urlFilter must be a non-empty ASCII string`);
      } else if (c.urlFilter.startsWith('||*')) {
        problems.push(`${at}: urlFilter cannot start with "||*"`);
      }
    }
    if (c.regexFilter !== undefined) {
      regexCount++;
      if (typeof c.regexFilter !== 'string' || !c.regexFilter) problems.push(`${at}: regexFilter must be a non-empty string`);
      else {
        try {
          new RegExp(c.regexFilter);
        } catch (err) {
          problems.push(`${at}: regexFilter does not compile: ${(err as Error).message}`);
        }
        // Chrome uses RE2: no lookaround, no backreferences.
        if (/\(\?[=!<]|\\[1-9]/.test(c.regexFilter)) problems.push(`${at}: regexFilter uses syntax RE2 does not support`);
      }
    }
    if (c.isUrlFilterCaseSensitive !== undefined && typeof c.isUrlFilterCaseSensitive !== 'boolean') {
      problems.push(`${at}: isUrlFilterCaseSensitive must be boolean`);
    }

    // Domains
    for (const key of ['initiatorDomains', 'excludedInitiatorDomains', 'requestDomains', 'excludedRequestDomains'] as const) {
      const list = c[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length === 0) problems.push(`${at}: ${key} must be a non-empty array`);
      else for (const d of list) if (!isDomain(d)) problems.push(`${at}: ${key} has invalid domain ${JSON.stringify(d)}`);
    }
    if (c.domainType !== undefined && c.domainType !== 'firstParty' && c.domainType !== 'thirdParty') {
      problems.push(`${at}: invalid domainType ${JSON.stringify(c.domainType)}`);
    }

    // Resource types and methods
    for (const key of ['resourceTypes', 'excludedResourceTypes'] as const) {
      const list = c[key];
      if (list === undefined) continue;
      if (!Array.isArray(list) || list.length === 0) problems.push(`${at}: ${key} must be a non-empty array`);
      else for (const t of list) if (!RESOURCE_TYPES.includes(t)) problems.push(`${at}: ${key} has invalid type ${JSON.stringify(t)}`);
    }
    if (c.resourceTypes && c.excludedResourceTypes) problems.push(`${at}: resourceTypes and excludedResourceTypes are exclusive`);
    for (const key of ['requestMethods', 'excludedRequestMethods'] as const) {
      for (const m of c[key] ?? []) if (!REQUEST_METHODS.includes(m)) problems.push(`${at}: invalid ${key} entry ${m}`);
    }

    const handlesMainFrame = !!c.resourceTypes?.includes('main_frame');
    if (opts.mainFrameOnly) {
      if (JSON.stringify(c.resourceTypes) !== JSON.stringify(['main_frame'])) {
        problems.push(`${at}: Shorts rules must have resourceTypes exactly ["main_frame"]`);
      }
    } else {
      if (handlesMainFrame) problems.push(`${at}: ad rules must never act on main_frame navigations`);
      // Scoped to YouTube: the rule only ever applies to requests made by YouTube pages.
      const initiators = c.initiatorDomains ?? [];
      if (!initiators.some((d) => hostMatches(d, 'youtube.com'))) {
        problems.push(`${at}: non-main_frame rules need initiatorDomains containing "youtube.com"`);
      }
      for (const d of initiators) {
        if (!hostMatches(d, 'youtube.com') && !hostMatches(d, 'youtube-nocookie.com')) {
          problems.push(`${at}: initiatorDomains entry ${d} is not a YouTube domain`);
        }
      }
    }

    // Action specifics
    if (action.type === 'redirect') {
      const r = action.redirect;
      const kinds = r ? (['url', 'extensionPath', 'transform', 'regexSubstitution'] as const).filter((k) => r[k] !== undefined) : [];
      if (kinds.length !== 1) problems.push(`${at}: redirect needs exactly one of url/extensionPath/transform/regexSubstitution`);
      if (r?.regexSubstitution !== undefined && c.regexFilter === undefined) {
        problems.push(`${at}: regexSubstitution requires a regexFilter`);
      }
      if (r?.url !== undefined) {
        try {
          new URL(r.url);
        } catch {
          problems.push(`${at}: redirect url is not a valid URL`);
        }
      }
    } else if (action.redirect !== undefined) {
      problems.push(`${at}: only redirect actions may carry a redirect`);
    }
    if (action.type === 'allowAllRequests' && !(c.resourceTypes ?? []).every((t) => t === 'main_frame' || t === 'sub_frame')) {
      problems.push(`${at}: allowAllRequests must be limited to main_frame/sub_frame`);
    }
    if (action.type === 'allowAllRequests' && !c.resourceTypes) problems.push(`${at}: allowAllRequests requires resourceTypes`);
  }
  if (regexCount > 1000) problems.push(`${name}: more than 1000 regex rules`);
  return problems;
}

// ───────────────────────────── Load the shipped rulesets ─────────────────────────────

const files = import.meta.glob<unknown>('../../rules/*.json', { eager: true, import: 'default' });

function rulesetFile(id: string): { path: string; rules: unknown } | null {
  const resource = manifest.declarative_net_request.rule_resources.find((r) => r.id === id);
  const path = resource?.path ?? '';
  const key = Object.keys(files).find((k) => k.endsWith('/' + path));
  return key ? { path, rules: files[key] } : null;
}

const ads = rulesetFile(RULESET.ads);
const shorts = rulesetFile(RULESET.shorts);
const adRules = (Array.isArray(ads?.rules) ? ads.rules : []) as DnrRule[];
const shortsRules = (Array.isArray(shorts?.rules) ? shorts.rules : []) as DnrRule[];
/**
 * With default settings the service worker enables every ruleset (the manifest declares them off,
 * so a paused MonoTube never filters), and Chrome evaluates an extension's enabled rulesets together.
 */
const allRules = [...adRules, ...shortsRules];

const YT = 'https://www.youtube.com';
const WATCH_FRAME = `${YT}/watch?v=jNQXAC9IVRw`;
const fromYouTube = (url: string, type: ResourceType): DnrRequest => ({ url, type, initiator: YT });

function describeVerdict(v: Verdict): string {
  return v.action === 'none' ? 'no rule' : `${v.action} by rule ${v.rule.id}${v.action === 'redirect' ? ` -> ${v.url}` : ''}`;
}

// ───────────────────────────── Matcher self-tests (always run) ─────────────────────────────

describe('DNR test matcher (self-check against documented semantics)', () => {
  const rule = (id: number, type: ActionType, condition: DnrCondition, priority?: number): DnrRule => ({
    id,
    priority,
    action: { type },
    condition,
  });
  const matches = (condition: DnrCondition, req: DnrRequest) => ruleMatches(rule(1, 'block', condition), req);
  /** An XHR made by `initiator` (null: browser-initiated, no initiator). */
  const xhr = (url: string, initiator: string | null = YT): DnrRequest => ({
    url,
    type: 'xmlhttprequest',
    initiator: initiator ?? undefined,
  });

  it('"||" anchors to the host or a subdomain label', () => {
    const c = { urlFilter: '||doubleclick.net^' };
    expect(matches(c, xhr('https://googleads.g.doubleclick.net/pagead/id'))).toBe(true);
    expect(matches(c, xhr('https://doubleclick.net/'))).toBe(true);
    expect(matches(c, xhr('http://doubleclick.net:8080/x'))).toBe(true);
    expect(matches(c, xhr('https://notdoubleclick.net/'))).toBe(false);
    expect(matches(c, xhr('https://doubleclick.network/'))).toBe(false);
    expect(matches(c, xhr('https://example.com/?u=doubleclick.net'))).toBe(false);
    expect(matches(c, xhr('https://example.com/doubleclick.net/'))).toBe(false);
  });

  it('"^" matches separators and the end of the URL, but not letters, digits, _ - . %', () => {
    expect(matches({ urlFilter: '/ad^' }, xhr('https://x.com/ad?x=1'))).toBe(true);
    expect(matches({ urlFilter: '/ad^' }, xhr('https://x.com/ad'))).toBe(true);
    expect(matches({ urlFilter: '/ad^' }, xhr('https://x.com/ad/'))).toBe(true);
    for (const tail of ['s', '1', '_', '-', '.js', '%20']) {
      expect(matches({ urlFilter: '/ad^' }, xhr(`https://x.com/ad${tail}`)), tail).toBe(false);
    }
  });

  it('"|" anchors the start or end, "*" is a wildcard, plain text is a substring', () => {
    expect(matches({ urlFilter: '|https://ads.' }, xhr('https://ads.example.com/'))).toBe(true);
    expect(matches({ urlFilter: '|https://ads.' }, xhr('https://www.example.com/?r=https://ads.'))).toBe(false);
    expect(matches({ urlFilter: 'ad_status.js|' }, xhr('https://s.com/ad_status.js'))).toBe(true);
    expect(matches({ urlFilter: 'ad_status.js|' }, xhr('https://s.com/ad_status.js?v=1'))).toBe(false);
    expect(matches({ urlFilter: '/pagead/*/conversion' }, xhr('https://g.com/pagead/1/2/conversion'))).toBe(true);
    expect(matches({ urlFilter: 'api/stats/ads' }, xhr(`${YT}/api/stats/ads?ver=2`))).toBe(true);
    expect(matches({ urlFilter: 'api/stats/ads' }, xhr(`${YT}/api/stats/playback`))).toBe(false);
  });

  it('is case-insensitive unless isUrlFilterCaseSensitive is true', () => {
    expect(matches({ urlFilter: '/PageAd/' }, xhr('https://x.com/pagead/'))).toBe(true);
    expect(matches({ urlFilter: '/PageAd/', isUrlFilterCaseSensitive: true }, xhr('https://x.com/pagead/'))).toBe(false);
    expect(matches({ regexFilter: '/PAGEAD/' }, xhr('https://x.com/pagead/'))).toBe(true);
  });

  it('matches requestDomains and initiatorDomains including subdomains', () => {
    expect(matches({ requestDomains: ['doubleclick.net'] }, xhr('https://static.doubleclick.net/x'))).toBe(true);
    expect(matches({ requestDomains: ['doubleclick.net'] }, xhr('https://doubleclick.network/x'))).toBe(false);
    expect(
      matches({ requestDomains: ['doubleclick.net'], excludedRequestDomains: ['static.doubleclick.net'] }, xhr('https://static.doubleclick.net/x')),
    ).toBe(false);
    expect(matches({ initiatorDomains: ['youtube.com'] }, xhr('https://a.com/', 'https://www.youtube.com'))).toBe(true);
    expect(matches({ initiatorDomains: ['youtube.com'] }, xhr('https://a.com/', 'https://example.com'))).toBe(false);
    expect(matches({ initiatorDomains: ['youtube.com'] }, xhr('https://a.com/', null))).toBe(false);
    expect(matches({ excludedInitiatorDomains: ['youtube.com'] }, xhr('https://a.com/', 'https://m.youtube.com'))).toBe(false);
  });

  it('computes thirdParty relative to the initiator\'s registrable domain', () => {
    const third = { domainType: 'thirdParty' as const };
    expect(matches(third, xhr('https://i.ytimg.com/vi/x/hqdefault.jpg'))).toBe(true);
    expect(matches(third, xhr('https://rr3---sn-abc.googlevideo.com/videoplayback'))).toBe(true);
    expect(matches(third, xhr(`${YT}/api/stats/ads`))).toBe(false);
    expect(matches(third, xhr('https://youtube.com/x'))).toBe(false);
    expect(matches({ domainType: 'firstParty' }, xhr(`${YT}/youtubei/v1/player`))).toBe(true);
  });

  it('skips main_frame unless resourceTypes asks for it; honours resource type lists', () => {
    expect(matches({}, { url: `${YT}/`, type: 'main_frame' })).toBe(false);
    expect(matches({ resourceTypes: ['main_frame'] }, { url: `${YT}/`, type: 'main_frame' })).toBe(true);
    expect(matches({ resourceTypes: ['script'] }, xhr('https://a.com/'))).toBe(false);
    expect(matches({ excludedResourceTypes: ['xmlhttprequest'] }, xhr('https://a.com/'))).toBe(false);
    expect(matches({ excludedResourceTypes: ['main_frame'] }, xhr('https://a.com/'))).toBe(true);
  });

  it('lets the highest priority win, and allow beat block on equal priority', () => {
    const req = xhr('https://googleads.g.doubleclick.net/pagead/id');
    const block = rule(1, 'block', { requestDomains: ['doubleclick.net'] }, 1);
    const allow = rule(2, 'allow', { urlFilter: '/pagead/id' }, 2);
    expect(evaluate([block, allow], req).action).toBe('allow');
    expect(evaluate([{ ...block, priority: 3 }, allow], req).action).toBe('block');
    expect(evaluate([{ ...block, priority: 2 }, allow], req).action).toBe('allow');
    expect(evaluate([block], req).action).toBe('block');
    expect(evaluate([], req).action).toBe('none');
  });

  it('applies allowAllRequests matched on the frame to its subresources', () => {
    const block = rule(1, 'block', { requestDomains: ['doubleclick.net'] }, 1);
    const frameAllow = rule(2, 'allowAllRequests', { urlFilter: '||youtube.com/watch', resourceTypes: ['main_frame'] }, 2);
    const req = xhr('https://ad.doubleclick.net/x');
    expect(evaluate([block, frameAllow], req, WATCH_FRAME).action).toBe('allow');
    expect(evaluate([block, frameAllow], req, `${YT}/results?search_query=x`).action).toBe('block');
  });

  it('applies regexSubstitution with \\0-\\9 groups and literal "$", replacing the first match only', () => {
    const r: DnrRule = {
      id: 1,
      action: { type: 'redirect', redirect: { regexSubstitution: 'https://h.com/?id=\\1&all=\\0&cost=$5' } },
      condition: { regexFilter: '^https://a\\.com/s/([a-z]+)', resourceTypes: ['main_frame'] },
    };
    const v = evaluate([r], { url: 'https://a.com/s/abc/rest', type: 'main_frame' });
    expect(v).toMatchObject({ action: 'redirect', url: 'https://h.com/?id=abc&all=https://a.com/s/abc&cost=$5/rest' });
  });
});

// ───────────────────────────── Ad & tracker ruleset ─────────────────────────────

/** Requests YouTube needs to work. Each must survive for every listed resource type. */
const CRITICAL: [string, ResourceType[]][] = [
  ['https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1', ['xmlhttprequest', 'media', 'other']],
  [`${YT}/youtubei/v1/player?key=x`, ['xmlhttprequest']],
  [`${YT}/youtubei/v1/next`, ['xmlhttprequest']],
  [`${YT}/youtubei/v1/search`, ['xmlhttprequest']],
  [`${YT}/youtubei/v1/browse`, ['xmlhttprequest']],
  [`${YT}/api/timedtext?v=x`, ['xmlhttprequest']],
  [`${YT}/api/stats/watchtime?ns=yt`, ['xmlhttprequest', 'ping', 'image']],
  [`${YT}/api/stats/playback?ns=yt`, ['xmlhttprequest', 'ping', 'image']],
  ['https://i.ytimg.com/vi/x/hqdefault.jpg', ['image']],
  ['https://yt3.ggpht.com/a.jpg', ['image']],
  ['https://accounts.google.com/ServiceLogin', ['sub_frame', 'xmlhttprequest']],
  ['https://jnn-pa.googleapis.com/$rpc/x', ['xmlhttprequest']],
  ['https://www.google.com/js/th/abc.js', ['script']],
  [`${YT}/s/player/abc/player_ias.vflset/en_US/base.js`, ['script']],
  [`${YT}/s/desktop/abc/jsbin/desktop_polymer.vflset/desktop_polymer.js`, ['script']],
  ['https://static.doubleclick.net/instream/ad_status.js', ['script']],
  ['https://googleads.g.doubleclick.net/pagead/id', ['xmlhttprequest']],
];

/** Known ad/tracker requests. Each must be blocked for every listed resource type. */
const BLOCKED: [string, ResourceType[]][] = [
  ['https://googleads.g.doubleclick.net/pagead/viewthroughconversion/1/', ['image', 'script']],
  ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', ['script']],
  [`${YT}/api/stats/ads?ver=2`, ['xmlhttprequest', 'ping']],
  [`${YT}/pagead/adview?ai=x`, ['xmlhttprequest', 'ping']],
  [`${YT}/ptracking?ptk=x`, ['xmlhttprequest', 'ping']],
  [`${YT}/youtubei/v1/log_event?alt=json`, ['xmlhttprequest', 'ping']],
  ['https://www.google-analytics.com/collect', ['xmlhttprequest', 'ping', 'image']],
  ['https://www.googletagmanager.com/gtm.js', ['script']],
];

describe.runIf(ads)(`ad & tracker ruleset (${ads?.path ?? 'missing'})`, () => {
  it('is structurally valid and scoped to YouTube', () => {
    expect(validateRuleset(ads?.path ?? 'ads', ads?.rules, { mainFrameOnly: false })).toEqual([]);
  });

  it.each(CRITICAL)('never blocks %s', (url, types) => {
    for (const type of types) {
      const v = evaluate(allRules, fromYouTube(url, type), WATCH_FRAME);
      expect(['none', 'allow'], `${type}: ${describeVerdict(v)}`).toContain(v.action);
    }
  });

  it.each(BLOCKED)('blocks %s', (url, types) => {
    for (const type of types) {
      const v = evaluate(allRules, fromYouTube(url, type), WATCH_FRAME);
      expect(v.action, `${type}: ${describeVerdict(v)}`).toBe('block');
    }
  });

  it('leaves YouTube pages themselves alone', () => {
    for (const path of ['/', '/watch?v=jNQXAC9IVRw', '/results?search_query=a+b', '/@handle', '/feed/subscriptions']) {
      const v = evaluate(adRules, { url: YT + path, type: 'main_frame' });
      expect(v.action, `${path}: ${describeVerdict(v)}`).toBe('none');
    }
  });

  it('does not affect requests made by other websites', () => {
    for (const [url, types] of BLOCKED) {
      for (const type of types) {
        const v = evaluate(adRules, { url, type, initiator: 'https://news.example.com' });
        expect(v.action, `${url} (${type}) from example.com: ${describeVerdict(v)}`).toBe('none');
      }
    }
  });
});

if (!ads) {
  describe('ad & tracker ruleset', () => {
    it.skip('rules/ad-rules.json does not exist yet: ad ruleset checks skipped', () => {});
  });
}

// ───────────────────────────── Shorts redirect ruleset ─────────────────────────────

describe.runIf(shorts)(`Shorts redirect ruleset (${shorts?.path ?? 'missing'})`, () => {
  const navigate = (url: string, initiator?: string) => evaluate(allRules, { url, type: 'main_frame', initiator });

  it('is structurally valid and main_frame-only', () => {
    expect(validateRuleset(shorts?.path ?? 'shorts', shorts?.rules, { mainFrameOnly: true })).toEqual([]);
  });

  it.each([undefined, YT])('redirects /shorts/<id> to /?mt_shorts=<id> (initiator %s)', (initiator) => {
    const v = navigate(`${YT}/shorts/abcDEF12345`, initiator);
    expect(v).toMatchObject({ action: 'redirect', url: `${YT}/?${SHORTS_PARAM}=abcDEF12345` });
  });

  it.each(['?feature=share', '?si=AbC123xyz_-'])('keeps the id clean for shared links (%s)', (query) => {
    const v = navigate(`${YT}/shorts/abcDEF12345${query}`);
    expect(v.action, describeVerdict(v)).toBe('redirect');
    const target = new URL(v.action === 'redirect' ? v.url : YT);
    expect(target.origin + target.pathname).toBe(`${YT}/`);
    expect(getBlockedShortsId(target)).toBe('abcDEF12345');
  });

  it.each(['/shorts', '/shorts/'])('sends %s home', (path) => {
    const v = navigate(YT + path);
    expect(v.action, describeVerdict(v)).toBe('redirect');
    const target = new URL(v.action === 'redirect' ? v.url : YT);
    expect(target.origin).toBe(YT);
    expect(getPageType(target)).toBe('home');
    expect(getBlockedShortsId(target)).toBeNull();
  });

  it.each(['/watch?v=abcDEF12345', '/@chan/shorts', '/@chan/shorts/', '/results?search_query=shorts', '/', '/feed/subscriptions'])(
    'does not redirect %s',
    (path) => {
      const v = navigate(YT + path);
      expect(v.action, describeVerdict(v)).toBe('none');
    },
  );

  it('does not loop: the redirect target is not redirected again', () => {
    expect(navigate(`${YT}/?${SHORTS_PARAM}=abcDEF12345`).action).toBe('none');
  });

  it('never rewrites subresource requests (only top-level navigations)', () => {
    for (const type of ['sub_frame', 'xmlhttprequest', 'script', 'image'] as const) {
      const v = evaluate(shortsRules, fromYouTube(`${YT}/shorts/abcDEF12345`, type));
      expect(v.action, type).toBe('none');
    }
  });
});

if (!shorts) {
  describe('Shorts redirect ruleset', () => {
    it.skip('rules/shorts-rules.json does not exist yet: Shorts ruleset checks skipped', () => {});
  });
}

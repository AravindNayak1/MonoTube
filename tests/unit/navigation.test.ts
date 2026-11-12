import { describe, expect, it } from 'vitest';
import { SHORTS_PARAM } from '../../src/shared/constants';
import {
  buildSearchPath,
  getBlockedShortsId,
  getPageType,
  getSearchQuery,
  getShortsId,
  getWatchId,
  isChannelShortsTab,
  isMixWatch,
  isPlaylistWatch,
  plainWatchPath,
  watchPath,
  type PageType,
} from '../../src/shared/navigation';

const ORIGIN = 'https://www.youtube.com';
const u = (pathAndQuery: string) => new URL(pathAndQuery, ORIGIN);

describe('getPageType', () => {
  const cases: [string, PageType][] = [
    // Home (including the Shorts DNR redirect target and YouTube's legacy /index)
    ['/', 'home'],
    ['', 'home'],
    ['/?mt_shorts=abcDEF12345', 'home'],
    ['/?feature=ytca', 'home'],
    ['/index', 'home'],
    ['https://www.youtube.com//', 'home'],
    // Search
    ['/results?search_query=a+b', 'search'],
    ['/results?search_query=lofi+hip+hop&sp=EgIQAQ%253D%253D', 'search'],
    ['/results', 'search'],
    ['/results/', 'search'],
    ['/search?q=test', 'search'],
    // Watch
    ['/watch?v=dQw4w9WgXcQ', 'watch'],
    ['/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=2', 'watch'],
    ['/watch?v=jNQXAC9IVRw&t=10s', 'watch'],
    ['/watch/', 'watch'],
    // Shorts
    ['/shorts/abcDEF12345', 'shorts'],
    ['/shorts/abcDEF12345?feature=share', 'shorts'],
    ['/shorts', 'shorts'],
    ['/shorts/', 'shorts'],
    // Channels (any tab, including the channel's Shorts tab)
    ['/@handle', 'channel'],
    ['/@handle/', 'channel'],
    ['/@handle/videos', 'channel'],
    ['/@handle/shorts', 'channel'],
    ['/@Some.Handle-1/featured', 'channel'],
    ['/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw', 'channel'],
    ['/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/playlists', 'channel'],
    ['/c/GoogleDevelopers', 'channel'],
    ['/user/GoogleDevelopers', 'channel'],
    // The user's own feeds
    ['/feed/subscriptions', 'feed'],
    ['/feed/subscriptions/', 'feed'],
    ['/feed/history', 'feed'],
    ['/feed/library', 'feed'],
    ['/feed/playlists', 'feed'],
    ['/feed/you', 'feed'],
    ['/playlist?list=WL', 'feed'],
    ['/playlist?list=LL', 'feed'],
    // Algorithmic feeds
    ['/feed/trending', 'explore'],
    ['/feed/trending/', 'explore'],
    ['/feed/explore', 'explore'],
    ['/feed/storefront', 'explore'],
    ['/gaming', 'explore'],
    ['/gaming/', 'explore'],
    // Everything else
    ['/about', 'other'],
    ['/premium', 'other'],
    ['/account', 'other'],
    ['/shortsx', 'other'],
    ['/watchlater', 'other'],
    ['/channel', 'other'],
    ['/@', 'other'],
  ];

  it.each(cases)('%s -> %s', (path, expected) => {
    expect(getPageType(u(path))).toBe(expected);
  });

  it('ignores the hash and the query when classifying', () => {
    expect(getPageType(u('/results#top'))).toBe('search');
    expect(getPageType(u('/?v=abcDEF12345'))).toBe('home');
  });
});

describe('buildSearchPath', () => {
  it('uses YouTube\'s own format with "+" for spaces', () => {
    expect(buildSearchPath('a b')).toBe('/results?search_query=a+b');
    expect(buildSearchPath('lofi hip hop')).toBe('/results?search_query=lofi+hip+hop');
  });

  it('trims and collapses whitespace (spaces, tabs, newlines)', () => {
    expect(buildSearchPath('   lofi    hip\thop \n ')).toBe('/results?search_query=lofi+hip+hop');
  });

  it('encodes characters that are meaningful in URLs', () => {
    expect(buildSearchPath('c++ & rust?')).toBe('/results?search_query=c%2B%2B+%26+rust%3F');
    expect(buildSearchPath('#shorts')).toBe('/results?search_query=%23shorts');
    expect(buildSearchPath('a=b/c')).toBe('/results?search_query=a%3Db%2Fc');
    expect(buildSearchPath('100%')).toBe('/results?search_query=100%25');
  });

  it('percent-encodes unicode as UTF-8', () => {
    expect(buildSearchPath('café 東京')).toBe('/results?search_query=caf%C3%A9+%E6%9D%B1%E4%BA%AC');
    expect(buildSearchPath('🎵 music')).toBe('/results?search_query=%F0%9F%8E%B5+music');
  });

  it.each(['a b', 'c++ & rust?', '#shorts', 'café 東京', '  spaced   out  ', '"exact phrase" -minus', 'a+b'])(
    'round-trips %j through getSearchQuery',
    (query) => {
      const url = u(buildSearchPath(query));
      expect(getPageType(url)).toBe('search');
      expect(getSearchQuery(url)).toBe(query.trim().replace(/\s+/g, ' '));
    },
  );
});

describe('getSearchQuery', () => {
  it('reads search_query (with "+" as space)', () => {
    expect(getSearchQuery(u('/results?search_query=a+b'))).toBe('a b');
    expect(getSearchQuery(u('/results?search_query=c%2B%2B'))).toBe('c++');
  });

  it('trims the query', () => {
    expect(getSearchQuery(u('/results?search_query=%20%20x%20'))).toBe('x');
  });

  it('falls back to the q parameter', () => {
    expect(getSearchQuery(u('/search?q=foo'))).toBe('foo');
    expect(getSearchQuery(u('/results?q=bar'))).toBe('bar');
  });

  it('returns null for an empty or missing query', () => {
    expect(getSearchQuery(u('/results'))).toBeNull();
    expect(getSearchQuery(u('/results?search_query='))).toBeNull();
    expect(getSearchQuery(u('/results?search_query=+++'))).toBeNull();
  });

  it('returns null outside the search page', () => {
    expect(getSearchQuery(u('/watch?v=abcDEF12345&search_query=x'))).toBeNull();
    expect(getSearchQuery(u('/?search_query=x'))).toBeNull();
  });
});

describe('getShortsId', () => {
  it.each([
    ['/shorts/abcDEF12345', 'abcDEF12345'],
    ['/shorts/abc-DEF_123', 'abc-DEF_123'],
    ['/shorts/abcDEF12345/', 'abcDEF12345'],
    ['/shorts/abcDEF12345?feature=share', 'abcDEF12345'],
    ['/shorts/abcDEF12345?si=Xy1_Ab', 'abcDEF12345'],
    ['/shorts/abcDEF12345#t=3', 'abcDEF12345'],
    ['/shorts/abcdef', 'abcdef'], // 6 chars: shortest accepted id
  ])('%s -> %s', (path, id) => {
    expect(getShortsId(u(path))).toBe(id);
  });

  it.each([
    '/shorts',
    '/shorts/',
    '/shorts/abc', // too short
    '/shorts/abcdefghijklmnopqrstu', // 21 chars: too long
    '/shorts/abc.DEF!123',
    '/shorts/abc%20DEF123',
    '/watch?v=abcDEF12345',
    '/@handle/shorts',
    '/@handle/shorts/abcDEF12345',
    '/',
  ])('%s -> null', (path) => {
    expect(getShortsId(u(path))).toBeNull();
  });
});

describe('getBlockedShortsId', () => {
  it('reads the id carried by the Shorts redirect', () => {
    expect(SHORTS_PARAM).toBe('mt_shorts');
    expect(getBlockedShortsId(u('/?mt_shorts=abcDEF12345'))).toBe('abcDEF12345');
    expect(getBlockedShortsId(u('/?foo=1&mt_shorts=abc-DEF_123'))).toBe('abc-DEF_123');
  });

  it.each(['/', '/?mt_shorts=', '/?mt_shorts=abc', '/?mt_shorts=bad!id%3Cscript%3E', '/?mt_shorts=abcDEF12345%3Ffeature%3Dshare'])(
    '%s -> null',
    (path) => {
      expect(getBlockedShortsId(u(path))).toBeNull();
    },
  );
});

describe('getWatchId', () => {
  it('reads v on watch pages', () => {
    expect(getWatchId(u('/watch?v=dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ');
    expect(getWatchId(u('/watch?v=jNQXAC9IVRw&t=10s'))).toBe('jNQXAC9IVRw');
    expect(getWatchId(u('/watch?list=PL123&v=jNQXAC9IVRw&index=3'))).toBe('jNQXAC9IVRw');
  });

  it.each(['/watch', '/watch?v=', '/watch?v=%3Cscript%3E', '/watch?v=ab', '/results?v=dQw4w9WgXcQ', '/shorts/dQw4w9WgXcQ'])(
    '%s -> null',
    (path) => {
      expect(getWatchId(u(path))).toBeNull();
    },
  );
});

/** Mix / radio URLs as YouTube links them today (search results, artist cards, the "Mix" action). */
const MIX_URLS = [
  '/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk&start_radio=1', // song radio: RD<videoId>
  '/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk&start_radio=1&pp=ygUJZGVzcGFjaXRv', // + tracking param
  '/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk', // radio without start_radio
  '/watch?v=XXYlFuWEuKI&list=RDEMHSpo_Uv9STIRtF73zMywLg&start_radio=1', // artist Mix: RDEM…
  '/watch?v=R8om0QifqII&list=RDATfmbG9maSBoaXAgaG9w&start_radio=1', // topic Mix: RDAT…
  '/watch?v=dQw4w9WgXcQ&list=RDMM&start_radio=1', // "My Mix": RDMM
  '/watch?v=dQw4w9WgXcQ&start_radio=1', // start_radio alone
  '/watch?start_radio=1&list=RDdQw4w9WgXcQ&v=dQw4w9WgXcQ&index=3', // any parameter order
];

describe('isMixWatch', () => {
  it.each(MIX_URLS)('%s is a Mix', (path) => {
    expect(isMixWatch(u(path))).toBe(true);
  });

  it.each([
    '/watch?v=dQw4w9WgXcQ',
    '/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
    '/watch?v=dQw4w9WgXcQ&list=PL-osiE80TeTt2d9bfVyTiXJA-UTHn6WwU&index=2',
    '/watch?v=dQw4w9WgXcQ&list=WL&index=1', // Watch later
    '/watch?v=dQw4w9WgXcQ&list=LL', // Liked videos
    '/watch?v=dQw4w9WgXcQ&list=OLAK5uy_kxyz123', // album
    '/watch?v=dQw4w9WgXcQ&list=UUBR8-60-B28hp2BmDPdntcQ', // channel uploads
    '/watch?v=dQw4w9WgXcQ&list=PLRDxyz', // "RD" not at the start
    '/watch?v=dQw4w9WgXcQ&list=rdkJQP7kiw5Fk', // ids are case-sensitive
    '/watch?v=dQw4w9WgXcQ&start_radio=0',
    '/watch?v=dQw4w9WgXcQ&list=',
  ])('%s is not a Mix', (path) => {
    expect(isMixWatch(u(path))).toBe(false);
  });

  it('is false outside watch pages', () => {
    expect(isMixWatch(u('/playlist?list=RDkJQP7kiw5Fk'))).toBe(false);
    expect(isMixWatch(u('/results?search_query=x&list=RD1&start_radio=1'))).toBe(false);
    expect(isMixWatch(u('/?start_radio=1'))).toBe(false);
  });
});

describe('isPlaylistWatch', () => {
  it('is true only for watch pages with a non-empty list', () => {
    expect(isPlaylistWatch(u('/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf'))).toBe(true);
    expect(isPlaylistWatch(u('/watch?v=dQw4w9WgXcQ&list=WL&index=1'))).toBe(true);
    expect(isPlaylistWatch(u('/watch?v=dQw4w9WgXcQ&list=OLAK5uy_kxyz123'))).toBe(true);
    expect(isPlaylistWatch(u('/watch?v=dQw4w9WgXcQ'))).toBe(false);
    expect(isPlaylistWatch(u('/watch?v=dQw4w9WgXcQ&list='))).toBe(false);
    expect(isPlaylistWatch(u('/playlist?list=WL'))).toBe(false);
    expect(isPlaylistWatch(u('/results?search_query=x&list=PL1'))).toBe(false);
  });

  it.each(MIX_URLS)('treats the Mix %s as recommendations, not a playlist', (path) => {
    expect(isPlaylistWatch(u(path))).toBe(false);
  });

  it('treats a playlist opened with start_radio=1 as a Mix', () => {
    expect(isPlaylistWatch(u('/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&start_radio=1'))).toBe(false);
  });
});

describe('plainWatchPath', () => {
  it('drops the Mix / playlist context and every other parameter', () => {
    expect(plainWatchPath(u('/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk&start_radio=1&pp=ygUJZGVzcGFjaXRv'))).toBe('/watch?v=kJQP7kiw5Fk');
    expect(plainWatchPath(u('/watch?v=XXYlFuWEuKI&list=RDEMHSpo_Uv9STIRtF73zMywLg&start_radio=1'))).toBe('/watch?v=XXYlFuWEuKI');
    expect(plainWatchPath(u('/watch?list=RDATfmbG9maSBoaXAgaG9w&start_radio=1&v=R8om0QifqII&index=4'))).toBe('/watch?v=R8om0QifqII');
    expect(plainWatchPath(u('/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=2'))).toBe('/watch?v=dQw4w9WgXcQ');
    expect(plainWatchPath(u('/watch?v=dQw4w9WgXcQ#comments'))).toBe('/watch?v=dQw4w9WgXcQ');
  });

  it.each([
    ['/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk&start_radio=1&t=42', '/watch?v=kJQP7kiw5Fk&t=42'],
    ['/watch?v=kJQP7kiw5Fk&t=42s&list=RDkJQP7kiw5Fk', '/watch?v=kJQP7kiw5Fk&t=42s'],
    ['/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk&t=1h2m3s', '/watch?v=kJQP7kiw5Fk&t=1h2m3s'],
    ['/watch?v=kJQP7kiw5Fk&t=2m', '/watch?v=kJQP7kiw5Fk&t=2m'],
  ])('keeps a start time: %s -> %s', (path, expected) => {
    expect(plainWatchPath(u(path))).toBe(expected);
  });

  it.each([
    '/watch?v=kJQP7kiw5Fk&list=RDkJQP7kiw5Fk&t=abc',
    '/watch?v=kJQP7kiw5Fk&t=',
    '/watch?v=kJQP7kiw5Fk&t=42%26list%3DRDx', // decodes to "42&list=RDx": must not smuggle a list back
    '/watch?v=kJQP7kiw5Fk&t=-5',
    '/watch?v=kJQP7kiw5Fk&t=1.5',
    '/watch?v=kJQP7kiw5Fk&t=%3Cscript%3E',
  ])('drops a junk start time: %s', (path) => {
    expect(plainWatchPath(u(path))).toBe('/watch?v=kJQP7kiw5Fk');
  });

  it('round-trips: the result is a plain, non-Mix, non-playlist watch URL for the same video', () => {
    for (const path of MIX_URLS) {
      const plain = plainWatchPath(u(path));
      expect(plain, path).not.toBeNull();
      const url = u(plain ?? '');
      expect(getWatchId(url)).toBe(getWatchId(u(path)));
      expect(isMixWatch(url)).toBe(false);
      expect(isPlaylistWatch(url)).toBe(false);
    }
  });

  it.each(['/watch', '/watch?list=RDkJQP7kiw5Fk&start_radio=1', '/watch?v=bad!id', '/results?v=dQw4w9WgXcQ', '/shorts/dQw4w9WgXcQ', '/'])(
    '%s -> null (no valid watch id)',
    (path) => {
      expect(plainWatchPath(u(path))).toBeNull();
    },
  );
});

describe('isChannelShortsTab', () => {
  it.each([
    ['/@handle/shorts', true],
    ['/@handle/shorts/', true],
    ['/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/shorts', true],
    ['/c/GoogleDevelopers/shorts', true],
    ['/@handle', false],
    ['/@handle/videos', false],
    ['/@handle/shortsfeed', false],
    ['/shorts/abcDEF12345', false],
    ['/shorts', false],
    ['/watch?v=abcDEF12345', false],
  ] as const)('%s -> %s', (path, expected) => {
    expect(isChannelShortsTab(u(path))).toBe(expected);
  });
});

describe('watchPath', () => {
  it('builds a watch path and encodes the id defensively', () => {
    expect(watchPath('jNQXAC9IVRw')).toBe('/watch?v=jNQXAC9IVRw');
    expect(watchPath('a&b')).toBe('/watch?v=a%26b');
    expect(getWatchId(u(watchPath('abc-DEF_123')))).toBe('abc-DEF_123');
  });
});

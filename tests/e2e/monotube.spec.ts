/**
 * MonoTube end-to-end tests against live YouTube (www.youtube.com) with the built extension.
 *
 * YouTube is live and varies by region, experiment bucket and time, so these tests:
 *  - poll instead of sleeping and avoid exact counts,
 *  - skip (never fail) when YouTube shows a bot check or a consent wall that cannot be declined,
 *  - use long-lived public videos: "Me at the zoo" (jNQXAC9IVRw, 19 s) for page-load checks and
 *    Blender's "Big Buck Bunny" (aqz-KE-bpKQ, ~10 min) wherever playback must keep running.
 */

import type { Locator, Page } from '@playwright/test';
import { ATTR, OWN_NODE_ATTR, SHORTS_PARAM } from '../../src/shared/constants';
import { getWatchId } from '../../src/shared/navigation';
import { expect, skipIfYouTubeBlocks, test, YOUTUBE, launchWithExtension, openPopupIn, readSettings } from './fixtures';

const SHORT_VIDEO = 'jNQXAC9IVRw';
const LONG_VIDEO = 'aqz-KE-bpKQ';
/** A query whose results reliably mix in Shorts and shelves. */
const QUERY = 'sourdough bread recipe';
const QUERY_IN_URL = /\/results\?search_query=sourdough\+bread\+recipe/;

const SETTING_TOGGLES = [
  'enabled',
  'blockRecommendations',
  'blockShorts',
  'disableAutoplay',
  'hideEndScreens',
  'adFiltering',
  'hideComments',
] as const;

const html = (page: Page) => page.locator('html');
const overlay = (page: Page) => page.getByTestId('mt-home');

/** Visible genuine search results. */
const visibleResults = (page: Page): Locator => page.locator('ytd-search ytd-video-renderer').filter({ visible: true });

async function waitForResults(page: Page): Promise<Locator> {
  await expect(page).toHaveURL(/\/results\?search_query=/, { timeout: 30_000 });
  await skipIfYouTubeBlocks(page);
  const results = visibleResults(page);
  await expect(results.first()).toBeVisible({ timeout: 30_000 });
  return results;
}

/** Search from the MonoTube homepage overlay. */
async function searchFromOverlay(page: Page, query: string, via: 'enter' | 'button' = 'enter'): Promise<Locator> {
  await expect(overlay(page)).toBeVisible();
  const input = page.getByTestId('mt-search-input');
  await input.fill(query);
  if (via === 'enter') await input.press('Enter');
  else await page.getByTestId('mt-search-submit').click();
  return waitForResults(page);
}

/** The video id a result links to. */
async function resultVideoId(result: Locator): Promise<string> {
  const href = await result.locator('a#thumbnail').first().getAttribute('href');
  const id = href ? getWatchId(new URL(href, YOUTUBE)) : null;
  expect(id, `result links to a watch page (href=${href})`).not.toBeNull();
  return id as string;
}

/** Wait for the watch page player of `videoId`. */
async function waitForWatch(page: Page, videoId: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/watch\\?v=${videoId}`), { timeout: 30_000 });
  await expect(page.locator('#movie_player')).toBeVisible({ timeout: 30_000 });
  await skipIfYouTubeBlocks(page);
}

interface PlaybackState {
  ad: boolean;
  paused: boolean;
  time: number;
  ready: boolean;
}

async function playbackState(page: Page): Promise<PlaybackState> {
  return page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    const video = document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
    if (!player || !video) return { ad: false, paused: true, time: 0, ready: false };
    const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    return { ad, paused: video.paused, time: video.currentTime, ready: true };
  });
}

/** Press play through YouTube's own player API (falls back to the media element). */
async function pressPlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player') as (Element & { playVideo?: () => void }) | null;
    if (player?.playVideo) player.playVideo();
    else void document.querySelector<HTMLVideoElement>('#movie_player video')?.play().catch(() => {});
  });
}

/** Marker in the page's main world: survives SPA navigations, disappears on a full reload. */
async function setReloadMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __mtE2E?: string }).__mtE2E = 'same-document';
  });
}
/** The marker, undefined after a reload, or 'navigating' while the page is between documents. */
async function reloadMarker(page: Page): Promise<string | undefined> {
  return page
    .evaluate(() => (window as unknown as { __mtE2E?: string }).__mtE2E)
    .catch(() => 'navigating');
}

/** Computed display of the first element matching `selector`, or null if absent or navigating. */
async function displayOf(page: Page, selector: string): Promise<string | null> {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).display : null;
    }, selector)
    .catch(() => null);
}

// ───────────────────────────── Homepage & search ─────────────────────────────

test('homepage: the MonoTube overlay replaces the home feed', async ({ page, gotoYouTube }) => {
  await gotoYouTube('/');
  await expect(overlay(page)).toBeVisible();
  await expect(html(page)).toHaveAttribute(ATTR.overlay);
  await expect(html(page)).toHaveAttribute(ATTR.page, 'home');
  await expect(page.getByTestId('mt-search-input')).toBeVisible();
  await expect(page.getByTestId('mt-search-submit')).toBeVisible();
  // Give YouTube time to render its feed underneath; none of it may ever be visible.
  await page.waitForLoadState('load');
  await expect(page.locator('ytd-rich-item-renderer').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('ytd-browse[page-subtype="home"]').filter({ visible: true })).toHaveCount(0);
});

for (const via of ['enter', 'button'] as const) {
  test(`search from the overlay (${via === 'enter' ? 'Enter key' : 'submit button'}) shows genuine results`, async ({
    page,
    gotoYouTube,
  }) => {
    await gotoYouTube('/');
    const results = await searchFromOverlay(page, QUERY, via);
    await expect(page).toHaveURL(QUERY_IN_URL);
    await expect(html(page)).toHaveAttribute(ATTR.page, 'search');
    await expect(overlay(page)).toBeHidden();

    const first = results.first();
    await expect(first.locator('#video-title')).toHaveText(/\S/);
    await expect(first.locator('ytd-channel-name a, #channel-name a').filter({ visible: true }).first()).toHaveText(/\S/);
    await expect(first.locator('a#thumbnail')).toHaveAttribute('href', /\/watch\?v=/);
    await expect(first.locator('a#thumbnail img').first()).toHaveAttribute('src', /ytimg\.com|ggpht\.com/, { timeout: 20_000 });
  });
}

test('search results contain no Shorts and no shelves', async ({ page, gotoYouTube }) => {
  await gotoYouTube('/');
  const results = await searchFromOverlay(page, QUERY);
  await expect.poll(() => results.count()).toBeGreaterThan(3);
  // Shelves are rendered lazily alongside the first batch; let them arrive before asserting absence.
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(2_000);
  for (const selector of [
    'ytd-search ytd-shelf-renderer',
    'ytd-search ytd-reel-shelf-renderer',
    'ytd-search grid-shelf-view-model',
    'ytd-search ytm-shorts-lockup-view-model',
    'ytd-search a#thumbnail[href^="/shorts/"]',
    'ytd-search a[href^="/shorts/"]',
  ]) {
    await expect(page.locator(selector).filter({ visible: true }), selector).toHaveCount(0);
  }
});

test('"More results" loads one more batch on request', async ({ page, gotoYouTube }) => {
  await gotoYouTube('/');
  const results = await searchFromOverlay(page, QUERY);
  await expect(page.locator(`[${OWN_NODE_ATTR}="more-results"]`)).toBeAttached({ timeout: 20_000 });
  const more = page.getByTestId('mt-more-results');
  await expect(more).toBeVisible();
  const before = await results.count();
  await more.click();
  await expect
    .poll(() => results.count(), { timeout: 30_000, message: `more than ${before} results after "More results"` })
    .toBeGreaterThan(before);
});

test('clicking a result opens that video', async ({ page, gotoYouTube }) => {
  await gotoYouTube('/');
  const results = await searchFromOverlay(page, QUERY);
  const first = results.first();
  const id = await resultVideoId(first);
  await first.locator('#video-title').click();
  await waitForWatch(page, id);
  await expect(html(page)).toHaveAttribute(ATTR.page, 'watch');
});

// ───────────────────────────── Watch page ─────────────────────────────

test('playback works with ad filtering on', async ({ page, gotoYouTube, getSettings }, testInfo) => {
  test.slow(); // pre-roll ads can add tens of seconds
  expect((await getSettings()).adFiltering).toBe(true);
  await gotoYouTube(`/watch?v=${LONG_VIDEO}`);
  await waitForWatch(page, LONG_VIDEO);

  // Plain loop rather than expect.poll: test.skip() (bot check) must be able to escape it.
  let sawAd = false;
  let playing = false;
  const deadline = Date.now() + 120_000;
  while (!playing && Date.now() < deadline) {
    await skipIfYouTubeBlocks(page);
    const s = await playbackState(page);
    sawAd ||= s.ad;
    playing = s.ready && !s.ad && !s.paused && s.time > 2;
    if (playing) break;
    if (s.ready && s.paused && !s.ad) await pressPlay(page);
    await page.waitForTimeout(1_000);
  }
  expect(playing, 'main video plays past 2 s (after any ad)').toBe(true);

  const t1 = (await playbackState(page)).time;
  await page.waitForTimeout(3_000);
  const after = await playbackState(page);
  expect(after.ad).toBe(false);
  expect(after.time, 'currentTime keeps advancing').toBeGreaterThan(t1 + 1);

  // 19 (informational): count of ad breaks MonoTube handled on this page load.
  const handled = await html(page).getAttribute('data-mt-ads-handled');
  testInfo.annotations.push({
    type: 'ads',
    description: sawAd ? `ad break observed; data-mt-ads-handled=${handled}` : `no ad observed; data-mt-ads-handled=${handled}`,
  });
  if (sawAd) expect.soft(Number(handled), 'data-mt-ads-handled after an ad break').toBeGreaterThanOrEqual(1);
});

test('watch page hides the related sidebar and collapses #secondary', async ({ page, gotoYouTube }) => {
  await gotoYouTube(`/watch?v=${LONG_VIDEO}`);
  await waitForWatch(page, LONG_VIDEO);
  await expect(page.locator('ytd-watch-metadata').first()).toBeVisible({ timeout: 30_000 });
  // YouTube renders the related list a little after the metadata; wait for it to exist (hidden).
  await page
    .locator('ytd-watch-next-secondary-results-renderer')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => {});
  await expect(page.locator('ytd-watch-next-secondary-results-renderer').filter({ visible: true })).toHaveCount(0);
  // `.ytd-watch-flexy` picks the real columns, not the loading skeleton's look-alike ids.
  await expect(page.locator('ytd-watch-flexy #secondary.ytd-watch-flexy')).toBeHidden();
  await expect(page.locator('ytd-watch-flexy #related.ytd-watch-flexy')).toBeHidden();
});

test('YouTube autoplay is switched off', async ({ page, gotoYouTube }) => {
  await gotoYouTube(`/watch?v=${LONG_VIDEO}`);
  await waitForWatch(page, LONG_VIDEO);
  const state = page.locator('#movie_player .ytp-autonav-toggle-button[aria-checked]').first();
  await expect(state).toBeAttached({ timeout: 30_000 });
  await expect(state).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
});

test('end screens, end cards and info cards are hidden', async ({ page, gotoYouTube }) => {
  await gotoYouTube(`/watch?v=${SHORT_VIDEO}`);
  await waitForWatch(page, SHORT_VIDEO);
  await expect(html(page)).toHaveAttribute(ATTR.endscreen);
  // Inject the elements YouTube shows at the end of a video; MonoTube's CSS must hide them.
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    for (const cls of ['ytp-ce-element', 'ytp-endscreen-content', 'ytp-cards-teaser', 'ytp-videowall-still', 'mt-e2e-control']) {
      const el = document.createElement('div');
      el.className = cls;
      el.dataset.e2e = cls;
      el.textContent = cls;
      el.style.cssText = 'display:block;position:absolute;top:8px;left:8px;width:160px;height:48px;z-index:100;';
      player?.append(el);
    }
  });
  await expect(page.locator('[data-e2e="mt-e2e-control"]'), 'control element stays visible').toBeVisible();
  for (const cls of ['ytp-ce-element', 'ytp-endscreen-content', 'ytp-cards-teaser', 'ytp-videowall-still']) {
    await expect(page.locator(`[data-e2e="${cls}"]`), cls).toBeHidden();
  }
});

test('direct load of a watch URL works', async ({ page, gotoYouTube }) => {
  await gotoYouTube(`/watch?v=${SHORT_VIDEO}`);
  await waitForWatch(page, SHORT_VIDEO);
  await expect(html(page)).toHaveAttribute(ATTR.page, 'watch');
  await expect(page.locator('#movie_player video.html5-main-video')).toBeAttached();
  await expect(page.locator('ytd-watch-metadata #title').first()).toContainText(/zoo/i, { timeout: 30_000 });
  await expect(overlay(page)).toBeHidden();
});

// ───────────────────────────── Shorts ─────────────────────────────

test('a /shorts/<id> link is intercepted and "Watch anyway" opens the normal player', async ({ page, gotoYouTube }) => {
  const response = await gotoYouTube(`/shorts/${SHORT_VIDEO}`);
  // The network rule redirected the navigation before it reached YouTube (the page may tidy its
  // URL afterwards, so check the navigation's final URL rather than the current one).
  expect(response?.url() ?? page.url()).toBe(`${YOUTUBE}/?${SHORTS_PARAM}=${SHORT_VIDEO}`);
  await expect(html(page)).toHaveAttribute(ATTR.page, 'home');
  const notice = page.getByTestId('mt-shorts-notice');
  await expect(notice).toBeVisible();
  await expect(page.getByTestId('mt-go-search')).toBeVisible();
  await page.getByTestId('mt-watch-anyway').click();
  await waitForWatch(page, SHORT_VIDEO);
  await expect(notice).toBeHidden();
});

// ───────────────────────────── Navigation ─────────────────────────────

test('nav pill "Home" returns from a video to the overlay without a reload', async ({ page, gotoYouTube }) => {
  await gotoYouTube(`/watch?v=${SHORT_VIDEO}`);
  await waitForWatch(page, SHORT_VIDEO);
  await expect(page.locator(`[${OWN_NODE_ATTR}="nav"]`)).toBeAttached({ timeout: 20_000 });
  await setReloadMarker(page);
  await page.getByTestId('mt-nav-home').click();
  await expect(page).toHaveURL(`${YOUTUBE}/`);
  await expect(overlay(page)).toBeVisible();
  expect(await reloadMarker(page), 'navigation stayed in the same document').toBe('same-document');
});

test('nav pill "Back" returns from a video to the results without a reload', async ({ page, gotoYouTube }) => {
  test.slow();
  await gotoYouTube('/');
  const results = await searchFromOverlay(page, QUERY);
  const resultsUrl = page.url();
  await setReloadMarker(page);
  const first = results.first();
  const id = await resultVideoId(first);
  await first.locator('#video-title').click();
  await waitForWatch(page, id);
  const back = page.getByTestId('mt-nav-back');
  await expect(back).toBeVisible({ timeout: 20_000 });
  await back.click();
  await expect(page).toHaveURL(QUERY_IN_URL);
  expect(new URL(page.url()).searchParams.get('search_query')).toBe(new URL(resultsUrl).searchParams.get('search_query'));
  await expect(visibleResults(page).first()).toBeVisible({ timeout: 30_000 });
  expect(await reloadMarker(page), 'navigation stayed in the same document').toBe('same-document');
});

// ───────────────────────────── Popup ─────────────────────────────

test('popup switches exist, and turning MonoTube off/on applies to an open YouTube tab', async ({
  page,
  gotoYouTube,
  openPopup,
}) => {
  await gotoYouTube('/');
  await expect(overlay(page)).toBeVisible();

  const popup = await openPopup();
  for (const key of SETTING_TOGGLES) {
    const toggle = popup.getByTestId(`toggle-${key}`);
    await expect(toggle, key).toBeVisible();
    await expect(toggle, key).toHaveAttribute('role', 'switch');
    await expect(toggle, key).toHaveAttribute('aria-checked', /^(true|false)$/);
  }
  for (const theme of ['dark', 'light', 'system']) {
    await expect(popup.getByTestId(`theme-${theme}`)).toHaveAttribute('aria-checked', /^(true|false)$/);
  }
  await expect(popup.getByTestId('restore')).toBeVisible();

  const enabled = popup.getByTestId('toggle-enabled');
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'false');

  await page.bringToFront();
  await expect(html(page)).not.toHaveAttribute(ATTR.enabled);
  await expect(overlay(page)).toBeHidden();
  await expect
    .poll(() => displayOf(page, 'ytd-browse[page-subtype="home"]'), { message: 'YouTube home feed is displayed' })
    .toMatch(/^(?!none$)[a-z-]+$/);

  await popup.bringToFront();
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await page.bringToFront();
  await expect(html(page)).toHaveAttribute(ATTR.enabled);
  await expect(overlay(page)).toBeVisible();
  await expect.poll(() => displayOf(page, 'ytd-browse[page-subtype="home"]')).toBe('none');
});

test('"Restore YouTube" switches MonoTube off and reloads YouTube tabs as plain YouTube', async ({
  page,
  gotoYouTube,
  openPopup,
  getSettings,
}) => {
  await gotoYouTube('/');
  await expect(overlay(page)).toBeVisible();
  await setReloadMarker(page);

  const popup = await openPopup();
  await popup.getByTestId('restore').click();
  const confirm = popup.getByTestId('restore-confirm');
  await expect(confirm).toBeVisible();
  // restore-confirm is either the confirmation step's button or the confirmation message.
  if (await confirm.evaluate((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')) await confirm.click();

  await expect.poll(async () => (await getSettings()).enabled).toBe(false);
  await page.bringToFront();
  await expect.poll(() => reloadMarker(page), { timeout: 30_000, message: 'YouTube tab was reloaded' }).toBeUndefined();
  await expect(html(page)).not.toHaveAttribute(ATTR.enabled);
  await expect(overlay(page)).toBeHidden();
});

test('theme: light applies to the popup, the YouTube page and MonoTube UI', async ({ page, gotoYouTube, openPopup }) => {
  await gotoYouTube('/');
  await expect(overlay(page)).toBeVisible();
  await expect(html(page)).toHaveAttribute(ATTR.theme, 'dark');

  const popup = await openPopup();
  await popup.getByTestId('theme-light').click();
  await expect(popup.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'true');
  await expect(popup.getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'false');
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.bringToFront();
  await expect(html(page)).toHaveAttribute(ATTR.theme, 'light');
  await expect(page.locator('#monotube-root').locator('.mt[data-theme]').first()).toHaveAttribute('data-theme', 'light');
  // MonoTube also aligns YouTube's own appearance preference (PREF f6 theme bits), which YouTube
  // renders from on the next page load: the page then comes up genuinely light.
  await expect.poll(() => youtubeThemeBits(page)).toBe(YT_LIGHT_BIT);
  await page.reload();
  await expect(overlay(page)).toBeVisible();
  await expect(html(page)).not.toHaveAttribute('dark');

  await popup.getByTestId('theme-dark').click();
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(html(page)).toHaveAttribute(ATTR.theme, 'dark');
  await expect(page.locator('#monotube-root').locator('.mt[data-theme]').first()).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => youtubeThemeBits(page)).toBe(YT_DARK_BIT);
  await page.reload();
  await expect(overlay(page)).toBeVisible();
  await expect(html(page)).toHaveAttribute('dark', '');
});

const YT_DARK_BIT = 0x400;
const YT_LIGHT_BIT = 0x80000;

/** YouTube's appearance bits from its PREF cookie (f6 & (dark|light)). */
async function youtubeThemeBits(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = /(?:^|;\s*)PREF=([^;]*)/.exec(document.cookie);
    const f6 = m?.[1]?.split('&').find((p) => p.startsWith('f6='))?.slice(3);
    return f6 ? parseInt(f6, 16) & (0x400 | 0x80000) : 0;
  });
}

test('settings persist across a browser restart', async ({ extensionPath, browserTarget }, testInfo) => {
  const userDataDir = testInfo.outputPath('profile');
  let browser = await launchWithExtension({ extensionPath, userDataDir, browser: browserTarget });
  const firstId = browser.extensionId;
  try {
    const popup = await openPopupIn(browser);
    await popup.getByTestId('toggle-hideComments').click();
    await expect(popup.getByTestId('toggle-hideComments')).toHaveAttribute('aria-checked', 'true');
    await popup.getByTestId('toggle-blockShorts').click();
    await expect(popup.getByTestId('toggle-blockShorts')).toHaveAttribute('aria-checked', 'false');
    await popup.getByTestId('theme-light').click();
    await expect.poll(() => readSettings(browser)).toMatchObject({ hideComments: true, blockShorts: false, theme: 'light' });
  } finally {
    await browser.context.close();
  }

  browser = await launchWithExtension({ extensionPath, userDataDir, browser: browserTarget });
  try {
    expect(browser.extensionId).toBe(firstId);
    await expect.poll(() => readSettings(browser)).toMatchObject({ hideComments: true, blockShorts: false, theme: 'light' });
    const popup = await openPopupIn(browser);
    await expect(popup.getByTestId('toggle-hideComments')).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByTestId('toggle-blockShorts')).toHaveAttribute('aria-checked', 'false');
    await expect(popup.getByTestId('theme-light')).toHaveAttribute('aria-checked', 'true');
  } finally {
    await browser.context.close();
  }
});

test('with "Block recommendations" off, YouTube\'s homepage is left alone', async ({ page, gotoYouTube, setSettings }) => {
  await setSettings({ blockRecommendations: false });
  await gotoYouTube('/');
  await expect(html(page)).toHaveAttribute(ATTR.enabled);
  // Defaults apply at document_start; wait for the stored settings to take over.
  await expect(html(page)).not.toHaveAttribute(ATTR.recs);
  await page.waitForLoadState('load');
  await expect(html(page)).not.toHaveAttribute(ATTR.overlay);
  await expect(overlay(page)).toBeHidden();
  await expect(page.locator('ytd-app')).toBeVisible();
  await expect
    .poll(() => displayOf(page, 'ytd-browse[page-subtype="home"]'), { message: 'YouTube home feed is displayed' })
    .toMatch(/^(?!none$)[a-z-]+$/);
});

test('no MonoTube console errors during home -> search -> watch', async ({ page, gotoYouTube, collectConsoleErrors }) => {
  test.slow();
  const errors = collectConsoleErrors();
  await gotoYouTube('/');
  const results = await searchFromOverlay(page, QUERY);
  const first = results.first();
  const id = await resultVideoId(first);
  await first.locator('#video-title').click();
  await waitForWatch(page, id);
  await expect(page.locator('ytd-watch-metadata').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000); // let late module work (autoplay, ads, nav) run
  expect(errors).toEqual([]);
});

test('ad/tracker network rules are active on YouTube', async ({ page, gotoYouTube }) => {
  await gotoYouTube('/');
  const outcome = (url: string) =>
    page.evaluate(async (u) => {
      try {
        await fetch(u, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' });
        return 'loaded';
      } catch {
        return 'blocked';
      }
    }, url);
  expect(await outcome(`${YOUTUBE}/favicon.ico`), 'control request').toBe('loaded');
  expect(await outcome(`${YOUTUBE}/api/stats/ads?ver=2&mt_e2e=1`)).toBe('blocked');
  expect(await outcome(`${YOUTUBE}/pagead/adview?ai=mt_e2e`)).toBe('blocked');
});

test('keyboard: "/" focuses the overlay search, Esc clears it', async ({ page, gotoYouTube }) => {
  await gotoYouTube('/');
  const input = page.getByTestId('mt-search-input');
  await expect(input).toBeVisible();
  await input.blur();
  await expect(input).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(input).toBeFocused();
  await expect(input, '"/" is a shortcut, not typed').toHaveValue('');
  await page.keyboard.type('abc');
  await expect(input).toHaveValue('abc');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page).toHaveURL(`${YOUTUBE}/`);
});

/**
 * Playwright fixtures for MonoTube end-to-end tests.
 *
 * Extensions only load in a persistent browser context, so this file replaces Playwright's
 * `context` / `page` fixtures with a branded browser that has the built extension (dist/) loaded:
 *
 *  - Chrome (default): branded Chrome 137+ ignores --load-extension, so the extension is loaded
 *    through the DevTools protocol (Extensions.loadUnpacked), which requires
 *    --enable-unsafe-extension-debugging. Content scripts inject into pages loaded afterwards.
 *  - Edge (BROWSER=msedge): still honours --load-extension / --disable-extensions-except.
 *
 * Environment:
 *   HEADED=1                     show the browser
 *   BROWSER=msedge               use Microsoft Edge instead of Chrome
 *   MONOTUBE_EXTENSION_DIR=...   absolute path of the unpacked extension (default: <project>/dist)
 *
 * Every test gets a fresh temporary profile (deleted by Playwright on close). A test that needs a
 * specific profile, e.g. to restart the browser, calls launchWithExtension() itself.
 */

import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Response,
  type WebError,
  type Worker,
  type WorkerInfo,
} from '@playwright/test';
import { ATTR, SETTINGS_KEY } from '../../src/shared/constants';
import { normalizeSettings, type Settings } from '../../src/shared/settings';

export const YOUTUBE = 'https://www.youtube.com';

/** Read environment variables without depending on Node's type declarations. */
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export type BrowserTarget = 'chrome' | 'msedge';

export interface LaunchOptions {
  /** Absolute path of the unpacked extension directory. */
  extensionPath: string;
  /** Profile directory; '' (default) creates a temporary profile that is removed on close. */
  userDataDir?: string;
  browser?: BrowserTarget;
  headless?: boolean;
}

export interface LaunchedBrowser {
  context: BrowserContext;
  extensionId: string;
}

const BASE_ARGS = ['--autoplay-policy=no-user-gesture-required'];
const CONTEXT_OPTIONS = { viewport: { width: 1440, height: 900 }, locale: 'en-US' } as const;

const extensionOrigin = (id: string) => `chrome-extension://${id}/`;

/** The extension's service worker if it is running (MV3 workers stop when idle). */
function liveWorker(context: BrowserContext, extensionId: string): Worker | undefined {
  return context.serviceWorkers().find((w) => w.url().startsWith(extensionOrigin(extensionId)));
}

async function waitForWorker(context: BrowserContext, extensionId: string, timeout = 10_000): Promise<Worker | null> {
  const existing = liveWorker(context, extensionId);
  if (existing) return existing;
  return context
    .waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(extensionOrigin(extensionId)), timeout })
    .catch(() => liveWorker(context, extensionId) ?? null);
}

const samePath = (a: string, b: string) => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
};

/**
 * Resolve the extension id through CDP (needs --enable-unsafe-extension-debugging).
 * With `load`, installs the unpacked extension first (Chrome); otherwise only looks it up among
 * the unpacked extensions the browser already loaded (Edge via --load-extension, or a relaunched
 * profile that still has it).
 */
async function extensionIdViaCdp(context: BrowserContext, extensionPath: string, load: boolean): Promise<string | null> {
  const browser = context.browser();
  if (!browser) throw new Error('Persistent context has no browser handle; cannot open a CDP session.');
  const cdp = await browser.newBrowserCDPSession();
  const lookup = async () => {
    const { extensions } = await cdp.send('Extensions.getExtensions').catch(() => ({ extensions: [] }));
    return extensions.find((e) => samePath(e.path, extensionPath))?.id ?? null;
  };
  try {
    if (!load) return await lookup();
    try {
      return (await cdp.send('Extensions.loadUnpacked', { path: extensionPath })).id;
    } catch (err) {
      const known = await lookup();
      if (known) return known;
      throw err;
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Launch a browser with the extension loaded. Resolves once the extension's service worker has
 * finished its install-time initialisation, so tests never race its first settings write.
 */
export async function launchWithExtension(options: LaunchOptions): Promise<LaunchedBrowser> {
  const browser = options.browser ?? 'chrome';
  const headless = options.headless ?? !env.HEADED;
  const { extensionPath } = options;
  const args = [...BASE_ARGS, '--enable-unsafe-extension-debugging'];
  if (browser === 'msedge') args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`);
  const context = await chromium.launchPersistentContext(options.userDataDir ?? '', {
    ...CONTEXT_OPTIONS,
    channel: browser,
    headless,
    ignoreDefaultArgs: ['--disable-extensions'],
    args,
  });

  try {
    let extensionId = await extensionIdViaCdp(context, extensionPath, browser === 'chrome');
    if (!extensionId) {
      // Edge without CDP extension support: the only extension allowed to run is ours.
      const worker =
        context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) ??
        (await context.waitForEvent('serviceworker', {
          predicate: (w) => w.url().startsWith('chrome-extension://'),
          timeout: 20_000,
        }));
      extensionId = new URL(worker.url()).host;
    }

    const worker = await waitForWorker(context, extensionId);
    if (worker) {
      // Give onInstalled handlers (which may normalise/persist settings) a moment to finish.
      await worker
        .evaluate(async (key) => {
          for (let i = 0; i < 30; i++) {
            if ((await chrome.storage.local.get(key))[key] !== undefined) return;
            await new Promise((r) => setTimeout(r, 100));
          }
        }, SETTINGS_KEY)
        .catch(() => {});
    }
    return { context, extensionId };
  } catch (err) {
    await context.close().catch(() => {});
    throw new Error(
      `Could not load the extension from ${extensionPath} in ${browser}. Build it first (npm run build).\n${String(err)}`,
    );
  }
}

type StorageRequest = { op: 'get'; key: string } | { op: 'set'; key: string; value: unknown };

/** Runs inside the extension; must be self-contained (it is serialised by Playwright). */
async function storageOp(req: StorageRequest): Promise<unknown> {
  if (req.op === 'get') return (await chrome.storage.local.get(req.key))[req.key];
  await chrome.storage.local.set({ [req.key]: req.value });
  return null;
}

/**
 * Access chrome.storage.local from inside the extension: through its service worker when it is
 * running, else through a temporary extension page (MV3 workers stop when idle).
 */
async function extensionStorage(b: LaunchedBrowser, req: StorageRequest): Promise<unknown> {
  const worker = liveWorker(b.context, b.extensionId);
  if (worker) {
    try {
      return await worker.evaluate(storageOp, req);
    } catch {
      /* the worker stopped between lookup and evaluation: fall back to a page */
    }
  }
  const page = await b.context.newPage();
  try {
    await page.goto(extensionOrigin(b.extensionId) + 'popup.html');
    return await page.evaluate(storageOp, req);
  } finally {
    await page.close();
  }
}

/** Raw value stored under the settings key (undefined when nothing was saved yet). */
export async function readStoredSettings(b: LaunchedBrowser): Promise<unknown> {
  return extensionStorage(b, { op: 'get', key: SETTINGS_KEY });
}

export async function readSettings(b: LaunchedBrowser): Promise<Settings> {
  return normalizeSettings(await readStoredSettings(b));
}

/** Merge `patch` into the stored settings exactly as the popup would. Returns the new settings. */
export async function writeSettings(b: LaunchedBrowser, patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await readSettings(b)), ...patch });
  await extensionStorage(b, { op: 'set', key: SETTINGS_KEY, value: next });
  await expect.poll(() => readSettings(b), { message: 'settings write did not stick' }).toEqual(next);
  return next;
}

/** Open the extension popup as a regular tab. */
export async function openPopupIn(b: LaunchedBrowser): Promise<Page> {
  const popup = await b.context.newPage();
  await popup.goto(extensionOrigin(b.extensionId) + 'popup.html');
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

/** Dismiss YouTube's in-page cookie consent dialog whenever it gets in the way (EU regions). */
export async function prepareYouTubePage(page: Page): Promise<void> {
  await page.addLocatorHandler(page.locator('ytd-consent-bump-v2-lightbox tp-yt-paper-dialog'), async (dialog) => {
    await dialog.getByRole('button', { name: /reject all/i }).first().click();
  });
}

/**
 * Skip (not fail) the current test when YouTube refuses to serve the automated browser:
 * Google's "unusual traffic" interstitial, a consent wall that cannot be declined, or the
 * "Sign in to confirm you're not a bot" player check.
 */
export async function skipIfYouTubeBlocks(page: Page): Promise<void> {
  const url = new URL(page.url());
  base.skip(url.hostname === 'www.google.com' && url.pathname.startsWith('/sorry'), 'Google "unusual traffic" interstitial');
  base.skip(url.hostname === 'consent.youtube.com', 'YouTube consent wall could not be declined');
  const botCheck = page.getByText(/confirm you.?re not a bot/i).first();
  base.skip(await botCheck.isVisible().catch(() => false), 'YouTube bot check ("Sign in to confirm you\'re not a bot")');
}

/** Decline Google's consent interstitial (EU regions). Returns true if one was shown. */
async function passConsentPage(page: Page): Promise<boolean> {
  if (new URL(page.url()).hostname !== 'consent.youtube.com') return false;
  const reject = page.getByRole('button', { name: /reject all/i }).first();
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await page.waitForURL((u) => u.hostname === 'www.youtube.com', { timeout: 30_000 }).catch(() => {});
  }
  return true;
}

export interface GotoOptions {
  /** Page to navigate (default: the test's page). */
  page?: Page;
  /** Wait until the MonoTube content script has booted (default true). */
  waitForMonoTube?: boolean;
}

/** Console problems that come from MonoTube (content script, popup, service worker). */
export function isMonoTubeProblem(msg: ConsoleMessage): boolean {
  const text = msg.text();
  const fromExtension = msg.location().url.startsWith('chrome-extension://');
  if (msg.type() === 'error') return fromExtension || text.includes('MonoTube');
  // Feature-module failures are reported as warnings by the orchestrator ("[MonoTube] module … failed").
  if (msg.type() === 'warning') return text.includes('[MonoTube]');
  return false;
}

function describeConsole(msg: ConsoleMessage): string {
  const loc = msg.location();
  return `[${msg.type()}] ${msg.text()}${loc.url ? ` (${loc.url}:${loc.lineNumber})` : ''}`;
}

type TestFixtures = {
  /** Internal: the launched browser for this test. */
  monotube: LaunchedBrowser;
  context: BrowserContext;
  extensionId: string;
  page: Page;
  /** Open chrome-extension://<id>/popup.html in a new tab. */
  openPopup: () => Promise<Page>;
  /** Merge a patch into chrome.storage.local settings (as the popup would). */
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
  /** Read the stored settings (normalised). */
  getSettings: () => Promise<Settings>;
  /**
   * Navigate to a YouTube path, pass consent if needed, wait for MonoTube to boot. Resolves with
   * the navigation response (its url() is the final URL after redirects), or null when a consent
   * interstitial was in between.
   */
  gotoYouTube: (path?: string, options?: GotoOptions) => Promise<Response | null>;
  /** Start recording MonoTube console errors from every page; returns the live list. */
  collectConsoleErrors: () => string[];
};

type WorkerFixtures = {
  extensionPath: string;
  browserTarget: BrowserTarget;
};

/** Directory holding playwright.config.ts, without depending on node:path. */
function projectRoot(info: WorkerInfo): string {
  const file = info.config.configFile;
  if (file) return file.slice(0, Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')));
  return info.config.rootDir;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  extensionPath: [
    async ({}, use, workerInfo) => {
      const root = projectRoot(workerInfo);
      const sep = root.includes('\\') ? '\\' : '/';
      await use(env.MONOTUBE_EXTENSION_DIR || `${root}${sep}dist`);
    },
    { scope: 'worker' },
  ],

  browserTarget: [
    async ({}, use) => {
      await use(env.BROWSER === 'msedge' ? 'msedge' : 'chrome');
    },
    { scope: 'worker' },
  ],

  monotube: async ({ extensionPath, browserTarget }, use) => {
    const launched = await launchWithExtension({ extensionPath, browser: browserTarget });
    await use(launched);
    await launched.context.close();
  },

  context: async ({ monotube }, use) => {
    await use(monotube.context);
  },

  extensionId: async ({ monotube }, use) => {
    await use(monotube.extensionId);
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await prepareYouTubePage(page);
    await use(page);
  },

  openPopup: async ({ monotube }, use) => {
    await use(() => openPopupIn(monotube));
  },

  setSettings: async ({ monotube }, use) => {
    await use((patch) => writeSettings(monotube, patch));
  },

  getSettings: async ({ monotube }, use) => {
    await use(() => readSettings(monotube));
  },

  gotoYouTube: async ({ page }, use) => {
    await use(async (path = '/', options = {}) => {
      const target = options.page ?? page;
      const response = await target.goto(new URL(path, YOUTUBE).href, { waitUntil: 'domcontentloaded' });
      const consent = await passConsentPage(target);
      await skipIfYouTubeBlocks(target);
      if (options.waitForMonoTube !== false) {
        // data-mt-page is set synchronously at document_start, even when MonoTube is switched off.
        await expect(target.locator('html')).toHaveAttribute(ATTR.page, /\w/, { timeout: 15_000 });
      }
      return consent ? null : response;
    });
  },

  collectConsoleErrors: async ({ context }, use) => {
    const errors: string[] = [];
    let recording = false;
    const onConsole = (msg: ConsoleMessage) => {
      if (recording && isMonoTubeProblem(msg)) errors.push(describeConsole(msg));
    };
    const onWebError = (webError: WebError) => {
      const err = webError.error();
      const text = `${err.message}\n${err.stack ?? ''}`;
      if (recording && (text.includes('chrome-extension://') || text.includes('MonoTube'))) {
        errors.push(`[uncaught] ${err.message}`);
      }
    };
    context.on('console', onConsole);
    context.on('weberror', onWebError);
    await use(() => {
      recording = true;
      return errors;
    });
    context.off('console', onConsole);
    context.off('weberror', onWebError);
  },
});

export { expect };

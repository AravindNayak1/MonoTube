#!/usr/bin/env node
/**
 * Open a real browser window with MonoTube loaded from dist/, in a separate persistent dev
 * profile (.dev-profile/), so you can try the extension without touching your everyday profile.
 *
 *   npm run start               Chrome  (loads dist/ via the DevTools Protocol)
 *   npm run start -- --edge     Microsoft Edge (uses --load-extension)
 *
 * Chrome 137+ ignores --load-extension, so for Chrome this uses the supported automation path:
 * --enable-unsafe-extension-debugging + Extensions.loadUnpacked over a pipe connection.
 * Combine with `npm run dev` in another terminal, then reload the extension from
 * chrome://extensions (or restart this script) to pick up rebuilt files.
 */

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const edge = process.argv.includes('--edge');
const profile = resolve(root, edge ? '.dev-profile-edge' : '.dev-profile');

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/ not found — run `npm run build` (or `npm run dev`) first.');
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: edge ? 'msedge' : 'chrome',
  headless: false,
  viewport: null,
  ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
  args: edge
    ? [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--start-maximized']
    : ['--enable-unsafe-extension-debugging', '--start-maximized'],
});

if (!edge) {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: dist });
  console.log(`MonoTube loaded (extension id ${id}).`);
}

const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://www.youtube.com/');
console.log('Browser open. Close the window (or press Ctrl+C) to quit.');
context.on('close', () => process.exit(0));
process.on('SIGINT', () => context.close().finally(() => process.exit(0)));

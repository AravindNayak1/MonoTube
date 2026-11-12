/**
 * Playwright configuration for MonoTube end-to-end tests against live YouTube.
 *
 *   npm run build && npx playwright test          headless, branded Chrome (channel "chrome")
 *   HEADED=1 npx playwright test                  watch the browser
 *   BROWSER=msedge npx playwright test            Microsoft Edge (secondary target)
 *   MONOTUBE_EXTENSION_DIR=<dir> npx playwright test   load an extension from another directory
 *
 * The browser is launched by the fixtures in tests/e2e/fixtures.ts (a persistent context is
 * required to load an extension), so no `projects`/`use.channel` are configured here.
 * YouTube is a live, shared service: one worker, generous timeouts and a single retry.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

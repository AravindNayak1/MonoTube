/**
 * Vitest configuration for MonoTube unit tests.
 *
 * Unit tests run in Node by default; files that need a DOM opt in with a
 * `// @vitest-environment jsdom` comment on their first line.
 * End-to-end tests (tests/e2e) are Playwright specs and are deliberately excluded here.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Every test starts from a clean slate: stubbed globals (e.g. `chrome`) and spies are undone.
    unstubGlobals: true,
    restoreMocks: true,
    // Vitest empties every CSS import by default; `?raw` imports must return the real file so the
    // page stylesheet can be checked statically (tests/unit/page-css.test.ts).
    css: { include: [/\.css\?raw$/] },
  },
});

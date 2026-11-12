/**
 * Source of truth for dist/manifest.json (written by scripts/build.mjs).
 * Plain TypeScript with only erasable syntax so Node can import it directly.
 */

import pkg from '../package.json' with { type: 'json' };

const icons = {
  '16': 'icons/icon-16.png',
  '32': 'icons/icon-32.png',
  '48': 'icons/icon-48.png',
  '128': 'icons/icon-128.png',
};

export const manifest = {
  manifest_version: 3,
  name: 'MonoTube',
  short_name: 'MonoTube',
  version: pkg.version,
  description:
    'YouTube. Nothing Else. Search, watch, learn, leave: no recommendations, no Shorts, no autoplay, fewer ads and trackers.',
  minimum_chrome_version: '116',
  icons,
  action: {
    default_title: 'MonoTube',
    default_popup: 'popup.html',
    default_icon: icons,
  },
  background: {
    service_worker: 'service-worker.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.youtube.com/*'],
      js: ['content.js'],
      run_at: 'document_start',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'declarativeNetRequest'],
  host_permissions: ['https://www.youtube.com/*'],
  declarative_net_request: {
    rule_resources: [
      // Off by default: Chrome resets enabled rulesets to these defaults on every update, and a
      // paused MonoTube must never filter anything. The service worker enables what settings want.
      { id: 'ads', enabled: false, path: 'rules/ad-rules.json' },
      { id: 'shorts', enabled: false, path: 'rules/shorts-rules.json' },
    ],
  },
  commands: {
    'toggle-monotube': {
      suggested_key: { default: 'Alt+M' },
      description: 'Turn MonoTube on or off',
    },
  },
} as const;

export default manifest;

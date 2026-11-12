import { describe, expect, it } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import { COMMAND_TOGGLE, RULESET } from '../../src/shared/constants';
import { manifest } from '../../src/manifest';

/** Ruleset files present on disk, keyed as "rules/<name>.json" (same form as manifest paths). */
const ruleFiles = Object.keys(import.meta.glob('../../rules/*.json')).map((p) => p.replace(/^(\.\.\/)+/, ''));

describe('manifest', () => {
  it('is Manifest V3 and identifies as MonoTube at the package version', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('MonoTube');
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.version).toMatch(/^\d+(\.\d+){0,3}$/);
    expect(manifest.description.length).toBeLessThanOrEqual(132); // Chrome Web Store limit
  });

  it('asks for exactly the storage and declarativeNetRequest permissions', () => {
    expect([...manifest.permissions].sort()).toEqual(['declarativeNetRequest', 'storage']);
    expect(manifest.permissions).toHaveLength(2);
    expect(manifest).not.toHaveProperty('optional_permissions');
  });

  it('has host access to www.youtube.com only', () => {
    expect([...manifest.host_permissions]).toEqual(['https://www.youtube.com/*']);
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    const json = JSON.stringify(manifest);
    for (const broad of ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', '://*.youtube.com']) {
      expect(json, `must not request ${broad}`).not.toContain(broad);
    }
  });

  it('injects one isolated-world content script at document_start in the top frame of YouTube', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    const cs = manifest.content_scripts[0];
    expect([...cs.matches]).toEqual(['https://www.youtube.com/*']);
    expect([...cs.js]).toEqual(['content.js']);
    expect(cs.run_at).toBe('document_start');
    expect(cs.all_frames).toBe(false);
    expect('world' in cs ? (cs as { world?: string }).world : 'ISOLATED').toBe('ISOLATED');
    expect(cs).not.toHaveProperty('match_about_blank');
  });

  it('runs an ES-module service worker and a popup', () => {
    expect(manifest.background).toEqual({ service_worker: 'service-worker.js', type: 'module' });
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  it('binds Alt+M to the toggle command', () => {
    expect(Object.keys(manifest.commands)).toEqual([COMMAND_TOGGLE]);
    const cmd = manifest.commands[COMMAND_TOGGLE];
    expect(cmd.suggested_key.default).toBe('Alt+M');
    expect(cmd.description.length).toBeGreaterThan(0);
  });

  it('declares icons at the standard sizes', () => {
    expect(Object.keys(manifest.icons).sort()).toEqual(['128', '16', '32', '48']);
    for (const [size, path] of Object.entries(manifest.icons)) expect(path).toMatch(new RegExp(`${size}\\.png$`));
  });

  it('declares the DNR rulesets named by the RULESET constants', () => {
    const resources = manifest.declarative_net_request.rule_resources;
    expect(resources.map((r) => r.id).sort()).toEqual(Object.values(RULESET).sort());
    for (const r of resources) {
      expect(r.path).toMatch(/^rules\/[a-z0-9-]+\.json$/);
      expect(typeof r.enabled).toBe('boolean');
    }
    expect(new Set(resources.map((r) => r.path)).size).toBe(resources.length);
  });

  it.skipIf(ruleFiles.length === 0)(
    'ruleset paths match the files under rules/ exactly (skipped while rules/ is empty)',
    () => {
      const declared = manifest.declarative_net_request.rule_resources.map((r) => r.path).sort();
      expect(ruleFiles.sort()).toEqual(declared);
    },
  );
});

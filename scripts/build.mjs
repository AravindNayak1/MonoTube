#!/usr/bin/env node
/**
 * MonoTube build: produces a ready-to-load unpacked extension in dist/.
 *
 *   node scripts/build.mjs           production build (minified)
 *   node scripts/build.mjs --watch   development build, rebuilds on change
 *
 * Three Vite builds, because MV3 needs different output formats:
 *   content.js          IIFE (content scripts cannot be ES modules)
 *   service-worker.js   ES module ("type": "module" in the manifest)
 *   popup.html + assets React app
 * plus static files (icons, DNR rulesets) and manifest.json generated from src/manifest.ts.
 */

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync, watch as fsWatch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const mode = watch ? 'development' : 'production';

const shared = {
  configFile: false,
  root,
  mode,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
};

function libBuild(entry, fileName, format) {
  return build({
    ...shared,
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: !watch,
      sourcemap: watch ? 'inline' : false,
      target: 'chrome116',
      copyPublicDir: false,
      lib: { entry: resolve(root, entry), formats: [format], name: 'MonoTube', fileName: () => fileName },
      watch: watch ? {} : null,
    },
  });
}

function popupBuild() {
  return build({
    ...shared,
    root: resolve(root, 'src/popup'),
    base: './',
    plugins: [react()],
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: !watch,
      sourcemap: watch ? 'inline' : false,
      target: 'chrome116',
      copyPublicDir: false,
      rollupOptions: { input: resolve(root, 'src/popup/popup.html') },
      watch: watch ? {} : null,
    },
  });
}

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  if (existsSync(resolve(root, 'public'))) await cp(resolve(root, 'public'), dist, { recursive: true });
  await cp(resolve(root, 'rules'), resolve(dist, 'rules'), { recursive: true });
}

async function writeManifest() {
  // Import fresh each time (cache-busting query) so --watch picks up edits.
  const url = pathToFileURL(resolve(root, 'src/manifest.ts')).href + `?t=${Date.now()}`;
  const { manifest } = await import(url);
  await writeFile(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function verify() {
  const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8'));
  const required = [
    'manifest.json',
    'content.js',
    'service-worker.js',
    'popup.html',
    ...Object.values(manifest.icons),
    ...manifest.declarative_net_request.rule_resources.map((r) => r.path),
  ];
  const missing = required.filter((f) => !existsSync(resolve(dist, f)));
  if (missing.length) throw new Error(`Build output is missing: ${missing.join(', ')}`);
}

async function main() {
  const started = Date.now();
  await rm(dist, { recursive: true, force: true });
  await copyStatic();
  await writeManifest();
  await Promise.all([
    libBuild('src/content/index.ts', 'content.js', 'iife'),
    libBuild('src/background/service-worker.ts', 'service-worker.js', 'es'),
    popupBuild(),
  ]);
  if (!watch) {
    await verify();
    console.log(`MonoTube built to dist/ in ${Date.now() - started} ms — load it via chrome://extensions → Load unpacked.`);
    return;
  }
  console.log('MonoTube dev build watching for changes (dist/ is loadable as an unpacked extension)…');
  for (const dir of ['public', 'rules']) {
    if (!existsSync(resolve(root, dir))) continue;
    fsWatch(resolve(root, dir), { recursive: true }, () => copyStatic().catch(console.error));
  }
  fsWatch(resolve(root, 'src/manifest.ts'), () => writeManifest().catch(console.error));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

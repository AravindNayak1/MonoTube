/**
 * MonoTube service worker (Manifest V3, bundled as an ES module).
 *
 * Responsibilities:
 *  - Keep the static declarativeNetRequest rulesets ("ads", "shorts") and the toolbar badge in
 *    sync with the stored settings.
 *  - Migrate stored settings on install/update (fill defaults for new keys).
 *  - Alt+M (COMMAND_TOGGLE) flips the master switch.
 *  - "Restore YouTube" from the popup: disable MonoTube, give open pages a moment to put YouTube's
 *    own preferences back, then reload every open YouTube tab.
 *
 * MV3 workers are torn down when idle, so nothing here relies on in-memory state surviving
 * between events: every listener is registered synchronously at top level and every sync reads
 * or receives the settings it applies.
 */

import { COMMAND_TOGGLE, MSG, RULESET, SETTINGS_KEY, type RestoreResult } from '../shared/constants';
import { activeFeatures, normalizeSettings, type Settings } from '../shared/settings';
import { loadSettings, onSettingsChanged } from '../shared/storage';

/** Tabs the extension acts on (also the content-script match pattern and host permission). */
const YOUTUBE_TABS = 'https://www.youtube.com/*';

/**
 * How long "Restore YouTube" waits between switching MonoTube off and reloading YouTube tabs.
 * Open pages react to the change by switching YouTube's Autoplay back on and writing the user's
 * original theme into YouTube's preference cookie; YouTube needs a moment to persist its Autoplay
 * state, and a reload issued before that brings MonoTube's values back.
 */
const RESTORE_SETTLE_MS = 1_200;

const BADGE_PAUSED = { text: 'OFF', background: '#52525b', color: '#ffffff' } as const;
const TITLE_ACTIVE = 'MonoTube';
const TITLE_PAUSED = 'MonoTube (paused)';

type RulesetId = (typeof RULESET)[keyof typeof RULESET];

const log = (what: string) => (err: unknown) => console.error(`[MonoTube] ${what}:`, err);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// State sync
// ---------------------------------------------------------------------------------------------

/**
 * Tail of the sync queue. Syncs run strictly one after another so rapid toggles (popup clicks,
 * Alt+M mashing) cannot interleave a getEnabledRulesets/updateEnabledRulesets pair and leave a
 * ruleset in the wrong state. The tail never rejects, so one failure doesn't block later syncs.
 */
let syncQueue: Promise<void> = Promise.resolve();

/**
 * Apply settings to the rulesets and the badge. Queued behind any sync already in flight.
 * Without an argument the settings are read from storage when the sync actually runs, so it
 * always applies the latest stored state. The returned promise rejects if this sync failed.
 */
function syncState(settings?: Settings): Promise<void> {
  const run = syncQueue.then(async () => applyState(settings ?? (await loadSettings())));
  syncQueue = run.catch(() => {});
  return run;
}

async function applyState(settings: Settings): Promise<void> {
  await Promise.all([applyRulesets(settings), applyBadge(settings.enabled)]);
}

/** Enable/disable static rulesets, touching only those whose state differs from the desired one. */
async function applyRulesets(settings: Settings): Promise<void> {
  const features = activeFeatures(settings);
  const desired: Record<RulesetId, boolean> = {
    [RULESET.ads]: features.ads,
    [RULESET.shorts]: features.shorts,
  };
  const current = new Set(await chrome.declarativeNetRequest.getEnabledRulesets());
  const enableRulesetIds: string[] = [];
  const disableRulesetIds: string[] = [];
  for (const [id, on] of Object.entries(desired)) {
    if (on && !current.has(id)) enableRulesetIds.push(id);
    else if (!on && current.has(id)) disableRulesetIds.push(id);
  }
  if (enableRulesetIds.length === 0 && disableRulesetIds.length === 0) return;
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
}

/** Neutral grey "OFF" badge while paused; no badge while active. */
async function applyBadge(enabled: boolean): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ text: enabled ? '' : BADGE_PAUSED.text }),
    chrome.action.setBadgeBackgroundColor({ color: BADGE_PAUSED.background }),
    chrome.action.setBadgeTextColor({ color: BADGE_PAUSED.color }),
    chrome.action.setTitle({ title: enabled ? TITLE_ACTIVE : TITLE_PAUSED }),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Settings writes
// ---------------------------------------------------------------------------------------------

/**
 * Tail of the settings queue. Every read-modify-write of the stored settings made here (Alt+M,
 * Restore, install/update migration) runs strictly one after another and reads storage inside its
 * own step, so two Alt+M presses dispatched back to back (e.g. queued while the worker woke up)
 * flip twice instead of both reading the same old value. The tail never rejects.
 * (The popup serializes its own saves; a popup save racing a worker write is not covered.)
 */
let settingsQueue: Promise<unknown> = Promise.resolve();

/**
 * Queue `patch(current)` merged into the stored settings; resolves with the settings written.
 * Reads storage directly (errors propagate, unlike loadSettings, which falls back to defaults) so
 * a failed read can never cause the user's choices to be overwritten with defaults.
 */
function updateSettings(patch: (current: Settings) => Partial<Settings>): Promise<Settings> {
  const run = settingsQueue.then(async () => {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const current = normalizeSettings(data[SETTINGS_KEY]);
    const next = normalizeSettings({ ...current, ...patch(current) });
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
  settingsQueue = run.catch(() => {});
  return run;
}

/** Normalise and persist the stored settings so keys added in a new version get their defaults. */
function migrateSettings(): Promise<Settings> {
  return updateSettings(() => ({}));
}

function toggleEnabled(): Promise<Settings> {
  // The storage change listener picks this up and syncs rulesets + badge.
  return updateSettings((current) => ({ enabled: !current.enabled }));
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/**
 * Disable MonoTube, wait until the rulesets are off, give open YouTube pages a moment to restore
 * YouTube's own Autoplay and theme preferences, then reload them so every page comes back as plain
 * YouTube. Returns the number of tabs reloaded.
 */
async function restoreYouTube(): Promise<number> {
  const settings = await updateSettings(() => ({ enabled: false }));
  await syncState(settings);

  // A url filter works without the "tabs" permission because we hold the matching host permission.
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TABS });
  // Discarded tabs reload by themselves (with the new settings) when the user returns to them;
  // reloading them now would only wake them up for nothing.
  const ids = tabs
    .filter((tab) => !tab.discarded)
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) return 0;
  await sleep(RESTORE_SETTLE_MS);
  // A tab closed meanwhile just fails its reload and is not counted.
  const results = await Promise.allSettled(ids.map((id) => chrome.tabs.reload(id)));
  return results.filter((r) => r.status === 'fulfilled').length;
}

function isRestoreMessage(message: unknown): boolean {
  return (
    typeof message === 'object' && message !== null && (message as { type?: unknown }).type === MSG.restore
  );
}

// ---------------------------------------------------------------------------------------------
// Listeners (registered synchronously at top level, as MV3 requires)
// ---------------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  // Also runs on update. The manifest declares every ruleset off, and Chrome resets the enabled
  // rulesets to those defaults on install and update (it keeps them across browser restarts), so
  // nothing is filtered until the sync below enables the rulesets the settings call for. A paused
  // MonoTube therefore never filters anything, not even briefly after an update.
  (async () => {
    let settings: Settings | undefined;
    try {
      settings = await migrateSettings();
    } catch (err) {
      log('settings migration failed')(err);
    }
    await syncState(settings); // without migrated settings, syncState reads what is stored
  })().catch(log('state sync failed'));
});

// Having an onStartup listener also makes Chrome start the worker at browser launch, so the
// paused badge is shown right away instead of after the first other event.
chrome.runtime.onStartup.addListener(() => {
  syncState().catch(log('state sync failed'));
});

onSettingsChanged((settings) => {
  syncState(settings).catch(log('state sync failed'));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== COMMAND_TOGGLE) return;
  toggleEnabled().catch(log('toggle failed'));
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRestoreMessage(message) || sender.id !== chrome.runtime.id) return false;
  restoreYouTube().then(
    (reloadedTabs) => sendResponse({ ok: true, reloadedTabs } satisfies RestoreResult),
    (err: unknown) => {
      log('restore failed')(err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies RestoreResult);
    },
  );
  return true; // keep the channel open for the async response
});

// Every time the worker starts, re-assert the badge and rulesets. This covers cases no event
// reports, e.g. the extension being disabled and re-enabled (the badge resets, onInstalled and
// onStartup don't fire). Cheap and idempotent: it only changes what differs.
syncState().catch(log('state sync failed'));

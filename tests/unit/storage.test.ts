import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_KEY } from '../../src/shared/constants';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { loadSettings, onSettingsChanged, saveSettings } from '../../src/shared/storage';

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: string) => void;

/**
 * Minimal in-memory stand-in for chrome.storage with the promise-based MV3 API.
 * `set` notifies onChanged listeners synchronously-after-write like Chrome does (area "local").
 */
function installChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<ChangeListener>();
  const emit = (changes: Changes, area: string) => {
    for (const l of [...listeners]) l(changes, area);
  };
  const local = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: store[k], newValue: structuredClone(v) };
        store[k] = structuredClone(v);
      }
      emit(changes, 'local');
    }),
  };
  const onChanged = {
    addListener: vi.fn((l: ChangeListener) => void listeners.add(l)),
    removeListener: vi.fn((l: ChangeListener) => void listeners.delete(l)),
  };
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension' }, storage: { local, onChanged } });
  return { store, listeners, local, onChanged, emit };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    const { local } = installChrome();
    const s = await loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s).not.toBe(DEFAULT_SETTINGS);
    expect(local.get).toHaveBeenCalledWith(SETTINGS_KEY);
  });

  it('returns the stored settings', async () => {
    const stored = { ...DEFAULT_SETTINGS, enabled: false, hideComments: true, theme: 'system' };
    installChrome({ [SETTINGS_KEY]: stored });
    expect(await loadSettings()).toEqual(stored);
  });

  it('normalises corrupt or outdated stored data', async () => {
    installChrome({ [SETTINGS_KEY]: { enabled: 'no', blockShorts: false, theme: 'neon', legacyKey: 1 } });
    const s = await loadSettings();
    expect(s).toEqual({ ...DEFAULT_SETTINGS, blockShorts: false });
    expect(s).not.toHaveProperty('legacyKey');
  });

  it('returns defaults for a non-object stored value', async () => {
    installChrome({ [SETTINGS_KEY]: 'garbage' });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('tolerates an invalidated extension context (get throws synchronously)', async () => {
    const { local } = installChrome();
    local.get.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('tolerates a rejected read', async () => {
    const { local } = installChrome();
    local.get.mockRejectedValue(new Error('IO error'));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('tolerates chrome.storage being unavailable', async () => {
    vi.stubGlobal('chrome', undefined);
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('merges the patch into the stored settings and persists the full object', async () => {
    const { store, local } = installChrome({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, theme: 'light' } });
    const next = await saveSettings({ hideComments: true });
    expect(next).toEqual({ ...DEFAULT_SETTINGS, theme: 'light', hideComments: true });
    expect(local.set).toHaveBeenCalledTimes(1);
    expect(local.set).toHaveBeenCalledWith({ [SETTINGS_KEY]: next });
    expect(store[SETTINGS_KEY]).toEqual(next);
  });

  it('starts from defaults when nothing is stored', async () => {
    const { store } = installChrome();
    await saveSettings({ enabled: false });
    expect(store[SETTINGS_KEY]).toEqual({ ...DEFAULT_SETTINGS, enabled: false });
  });

  it('never persists invalid values or unknown keys', async () => {
    const { store } = installChrome({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, hideComments: true } });
    const patch = { theme: 'neon', blockShorts: 'off', extra: true } as unknown as Parameters<typeof saveSettings>[0];
    const next = await saveSettings(patch);
    // Valid stored values survive; each invalid patch value is normalised to its default.
    expect(next).toEqual({ ...DEFAULT_SETTINGS, hideComments: true });
    expect(store[SETTINGS_KEY]).toEqual(next);
    expect(store[SETTINGS_KEY]).not.toHaveProperty('extra');
  });

  it('round-trips through loadSettings', async () => {
    installChrome();
    const saved = await saveSettings({ adFiltering: false, theme: 'light' });
    expect(await loadSettings()).toEqual(saved);
  });
});

describe('onSettingsChanged', () => {
  it('delivers normalised settings when the local settings key changes', async () => {
    const { emit } = installChrome();
    const cb = vi.fn();
    onSettingsChanged(cb);
    emit({ [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, blockShorts: false, junk: 1 } } }, 'local');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, blockShorts: false });
  });

  it('fires for writes made through saveSettings', async () => {
    installChrome();
    const cb = vi.fn();
    onSettingsChanged(cb);
    await saveSettings({ theme: 'light' });
    expect(cb).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, theme: 'light' });
  });

  it('ignores other storage areas', () => {
    const { emit } = installChrome();
    const cb = vi.fn();
    onSettingsChanged(cb);
    for (const area of ['sync', 'session', 'managed']) {
      emit({ [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, enabled: false } } }, area);
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores changes to other keys', () => {
    const { emit } = installChrome();
    const cb = vi.fn();
    onSettingsChanged(cb);
    emit({ autoplayTouchedByMonoTube: { newValue: true } }, 'local');
    expect(cb).not.toHaveBeenCalled();
  });

  it('falls back to defaults when the settings key is removed or corrupted', () => {
    const { emit } = installChrome();
    const cb = vi.fn();
    onSettingsChanged(cb);
    emit({ [SETTINGS_KEY]: { oldValue: { enabled: false } } }, 'local');
    emit({ [SETTINGS_KEY]: { newValue: 'garbage' } }, 'local');
    expect(cb).toHaveBeenNthCalledWith(1, DEFAULT_SETTINGS);
    expect(cb).toHaveBeenNthCalledWith(2, DEFAULT_SETTINGS);
  });

  it('unsubscribes the exact listener it registered', () => {
    const { emit, onChanged, listeners } = installChrome();
    const cb = vi.fn();
    const off = onSettingsChanged(cb);
    expect(listeners.size).toBe(1);
    const registered = onChanged.addListener.mock.calls[0]?.[0];
    off();
    expect(onChanged.removeListener).toHaveBeenCalledWith(registered);
    expect(listeners.size).toBe(0);
    emit({ [SETTINGS_KEY]: { newValue: DEFAULT_SETTINGS } }, 'local');
    expect(cb).not.toHaveBeenCalled();
  });

  it('keeps independent subscriptions independent', () => {
    const { emit } = installChrome();
    const a = vi.fn();
    const b = vi.fn();
    const offA = onSettingsChanged(a);
    onSettingsChanged(b);
    offA();
    emit({ [SETTINGS_KEY]: { newValue: DEFAULT_SETTINGS } }, 'local');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns a harmless no-op when subscribing fails (context invalidated)', () => {
    const { onChanged } = installChrome();
    onChanged.addListener.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    const off = onSettingsChanged(vi.fn());
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
    expect(onChanged.removeListener).not.toHaveBeenCalled();
  });

  it('swallows errors while unsubscribing after the context was invalidated', () => {
    const { onChanged } = installChrome();
    const off = onSettingsChanged(vi.fn());
    onChanged.removeListener.mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    expect(() => off()).not.toThrow();
  });

  it('tolerates chrome being unavailable entirely', () => {
    vi.stubGlobal('chrome', undefined);
    const off = onSettingsChanged(vi.fn());
    expect(() => off()).not.toThrow();
  });
});

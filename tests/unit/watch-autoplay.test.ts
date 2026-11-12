// @vitest-environment jsdom
/**
 * Autoplay toggle decisions (src/content/watch-autoplay.ts) against a fake YouTube toggle that
 * behaves like the real one (verified Nov 2026): a placeholder aria-checked="true" on load, the
 * saved preference applied later (sessionStorage write + flip), honoured clicks flip synchronously.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('../../src/content/watch-autoplay');

let mod: Mod;
let state: HTMLElement;
let clicks = 0;
/** Whether YouTube currently honours clicks on the toggle. */
let honour = true;

function buildToggle(initial: 'true' | 'false'): void {
  document.body.replaceChildren();
  const player = document.createElement('div');
  player.id = 'movie_player';
  const button = document.createElement('button');
  button.className = 'ytp-autonav-toggle';
  state = document.createElement('div');
  state.className = 'ytp-autonav-toggle-button';
  state.setAttribute('aria-checked', initial);
  button.append(state);
  player.append(button);
  document.body.append(player);
  button.addEventListener('click', () => {
    clicks++;
    if (honour) state.setAttribute('aria-checked', state.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
}

/** YouTube applying the saved preference: sessionStorage record first, toggle flip right after. */
function applySaved(value: 'true' | 'false'): void {
  sessionStorage.setItem('yt-player-autonavstate', JSON.stringify({ data: value === 'true' ? '2' : '1', creation: Date.now() }));
  setTimeout(() => state.setAttribute('aria-checked', value), 30);
}

function stubChrome(incognito: boolean) {
  const store: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(store, items)),
    remove: vi.fn(async (key: string) => void delete store[key]),
  };
  vi.stubGlobal('chrome', { extension: { inIncognitoContext: incognito }, storage: { local } });
  return { store, local };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  sessionStorage.clear();
  clicks = 0;
  honour = true;
  vi.resetModules();
  mod = await import('../../src/content/watch-autoplay');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settledAutoplayState', () => {
  it('waits out the placeholder "on" when the saved preference is off', async () => {
    buildToggle('true');
    setTimeout(() => applySaved('false'), 700);
    const result = mod.settledAutoplayState(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toBe('false');
  });

  it('settles on "on" soon after YouTube applied a saved "on" (no flip)', async () => {
    buildToggle('true');
    setTimeout(() => applySaved('true'), 700);
    let settled: string | null | undefined;
    void mod.settledAutoplayState(new AbortController().signal).then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe('true');
  });

  it('ignores a sessionStorage record left by an earlier document in the tab', async () => {
    buildToggle('true');
    sessionStorage.setItem('yt-player-autonavstate', JSON.stringify({ data: '2', creation: Date.now() - 60_000 }));
    setTimeout(() => state.setAttribute('aria-checked', 'false'), 4_000); // the real saved state, late
    const result = mod.settledAutoplayState(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBe('false');
  });

  it('falls back to the state after the maximum wait', async () => {
    buildToggle('true');
    let settled: string | null | undefined;
    void mod.settledAutoplayState(new AbortController().signal).then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(settled).toBe('true');
  });

  it('resolves null when aborted', async () => {
    buildToggle('true');
    const abort = new AbortController();
    const result = mod.settledAutoplayState(abort.signal);
    abort.abort();
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBeNull();
  });
});

describe('switchAutoplay', () => {
  it('reports "switched" when its own click flipped the toggle', async () => {
    buildToggle('true');
    await expect(mod.switchAutoplay('false', new AbortController().signal)).resolves.toBe('switched');
    expect(state.getAttribute('aria-checked')).toBe('false');
    expect(clicks).toBe(1);
  });

  it('reports "already" when the toggle already reads the wanted state', async () => {
    buildToggle('false');
    await expect(mod.switchAutoplay('false', new AbortController().signal)).resolves.toBe('already');
    expect(clicks).toBe(0);
  });

  it('does not take credit for a flip YouTube made after an ignored click', async () => {
    buildToggle('true');
    honour = false;
    setTimeout(() => state.setAttribute('aria-checked', 'false'), 600);
    const result = mod.switchAutoplay('false', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBe('already');
  });

  it('retries ignored clicks until one is honoured', async () => {
    buildToggle('false');
    honour = false;
    setTimeout(() => (honour = true), 1_500);
    const result = mod.switchAutoplay('true', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(result).resolves.toBe('switched');
    expect(clicks).toBe(3); // at 0 and 1 s (ignored), at 2 s (honoured)
  });
});

describe('autoplayStaysOn', () => {
  it('resolves true once "on" held for the settle delay', async () => {
    buildToggle('true');
    let held: boolean | undefined;
    void mod.autoplayStaysOn(null, new AbortController().signal).then((v) => (held = v));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(held).toBeUndefined();
    await vi.advanceTimersByTimeAsync(600);
    expect(held).toBe(true);
  });

  it('resolves false when YouTube puts "off" back', async () => {
    buildToggle('true');
    setTimeout(() => state.setAttribute('aria-checked', 'false'), 800);
    const result = mod.autoplayStaysOn(null, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toBe(false);
  });

  it('after a click, waits for YouTube to save the setting (bounded)', async () => {
    buildToggle('true');
    let held: boolean | undefined;
    void mod.autoplayStaysOn(performance.now(), new AbortController().signal).then((v) => (held = v));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(held).toBeUndefined(); // no set_setting request seen yet
    await vi.advanceTimersByTimeAsync(4_500);
    expect(held).toBe(true);
  });
});

describe('touched record', () => {
  it('is stored in chrome.storage.local in a regular profile', async () => {
    const { store, local } = stubChrome(false);
    mod.setTouched(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.autoplayTouchedByMonoTube).toBe(true);
    await expect(mod.wasTouched()).resolves.toBe(true);
    mod.setTouched(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(local.remove).toHaveBeenCalledWith('autoplayTouchedByMonoTube');
    await expect(mod.wasTouched()).resolves.toBe(false);
  });

  it('never reads or writes the shared record in incognito', async () => {
    const { store, local } = stubChrome(true);
    store.autoplayTouchedByMonoTube = true; // the regular profile's record
    await expect(mod.wasTouched()).resolves.toBe(false);
    mod.setTouched(true);
    await expect(mod.wasTouched()).resolves.toBe(true); // this page's own change
    mod.setTouched(false);
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
    expect(local.remove).not.toHaveBeenCalled();
    expect(store.autoplayTouchedByMonoTube).toBe(true);
  });
});

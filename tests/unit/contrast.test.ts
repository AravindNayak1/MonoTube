import { describe, expect, it } from 'vitest';
import { TOKENS, type ThemeTokens } from '../../src/shared/brand';

/** WCAG 2.x relative luminance of an opaque #rrggbb colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not an opaque hex colour: ${hex}`);
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BACKGROUNDS = ['bg', 'bg-elevated', 'surface'] as const;

describe.each(Object.entries(TOKENS) as [string, ThemeTokens][])('%s theme tokens meet WCAG AA', (_name, t) => {
  const tok = (k: string) => {
    const v = t[k];
    if (!v) throw new Error(`missing token ${k}`);
    return v;
  };

  it.each(['text', 'text-2', 'text-3'])('%s is >= 4.5:1 on every background', (key) => {
    for (const bg of BACKGROUNDS) expect(contrast(tok(key), tok(bg)), `${key} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('text-3 stays quieter than text-2', () => {
    expect(contrast(tok('text-3'), tok('bg'))).toBeLessThan(contrast(tok('text-2'), tok('bg')));
  });

  it('button labels on accent-fill (and its hover) are >= 4.5:1', () => {
    expect(contrast(tok('on-accent'), tok('accent-fill'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tok('on-accent'), tok('accent-fill-hover'))).toBeGreaterThanOrEqual(4.5);
  });

  it('accent (icons, switch tracks) is >= 3:1 against its icon colour', () => {
    expect(contrast(tok('on-accent'), tok('accent'))).toBeGreaterThanOrEqual(3);
  });

  it('focus ring is >= 3:1 on every background', () => {
    for (const bg of BACKGROUNDS) expect(contrast(tok('focus'), tok(bg)), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it('"off" switch track is >= 3:1 against the surface and its white knob', () => {
    expect(contrast(tok('control-off'), tok('surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(tok('control-off'), '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});

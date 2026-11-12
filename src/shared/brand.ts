/**
 * MonoTube brand: names, logo geometry and design tokens.
 * Shared by the in-page UI (content script), the popup and the icon generator, so the
 * product looks identical everywhere. Geometry is exported as path data (no markup strings)
 * because content scripts on YouTube must not use innerHTML (Trusted Types).
 */

export const BRAND = {
  name: 'MonoTube',
  tagline: 'YouTube. Nothing Else.',
  motto: 'Search. Watch. Learn. Leave.',
  homeHeadline: 'What do you want to learn today?',
} as const;

/** Logo geometry on a 64×64 grid. */
export const LOGO = {
  viewBox: '0 0 64 64',
  /** Superellipse ("squircle") container. */
  squircle: 'M32 4C54.4 4 60 9.6 60 32S54.4 60 32 60 4 54.4 4 32 9.6 4 32 4Z',
  /** Rounded play triangle, optically centred. */
  play: 'M26 23Q26 20 28.58 21.55L43.42 30.45Q46 32 43.42 33.55L28.58 42.45Q26 44 26 41Z',
} as const;

/** Single-path monochrome mark: squircle with the play triangle cut out (use fill-rule="evenodd"). */
export const LOGO_MARK_PATH = `${LOGO.squircle} ${LOGO.play}`;

export type ThemeTokens = Record<string, string>;

/**
 * Design tokens. Exposed as CSS custom properties named --mt-<key>.
 *
 * Contrast contract (WCAG 2.x AA, checked against bg, bg-elevated and surface of the same theme,
 * including the faint glows drawn over bg):
 * - text, text-2, text-3: >= 4.5:1 (text-3 is the quietest step, still body-text legible).
 * - accent-fill / accent-fill-hover: >= 4.5:1 with on-accent, so they carry text labels.
 *   accent itself is only >= 3:1 with on-accent: use it for icons, dots, switch tracks; never
 *   as the background of a text label.
 * - focus: opaque, >= 3:1 against every background a focus ring is drawn on (WCAG 1.4.11).
 * - control-off: an "off" switch track, >= 3:1 against surface and against its white knob.
 */
export const TOKENS: { dark: ThemeTokens; light: ThemeTokens } = {
  dark: {
    bg: '#0b0b0e',
    'bg-elevated': '#131317',
    surface: '#18181d',
    'surface-hover': '#1f1f25',
    border: 'rgba(255, 255, 255, 0.08)',
    'border-strong': 'rgba(255, 255, 255, 0.14)',
    text: '#f4f4f5',
    'text-2': '#a1a1aa',
    'text-3': '#85858e',
    accent: '#ff5a4e',
    'accent-fill': '#d63a30',
    'accent-fill-hover': '#c8352b',
    'accent-soft': 'rgba(255, 90, 78, 0.14)',
    'on-accent': '#ffffff',
    focus: '#ff5a4e',
    'control-off': '#6a6a72',
    'glow-1': 'rgba(255, 90, 78, 0.10)',
    'glow-2': 'rgba(120, 130, 255, 0.07)',
    shadow: '0 1px 2px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.35)',
    'logo-bg': '#f4f4f5',
    'logo-fg': '#0b0b0e',
  },
  light: {
    bg: '#fafaf9',
    'bg-elevated': '#ffffff',
    surface: '#ffffff',
    'surface-hover': '#f4f4f3',
    border: 'rgba(0, 0, 0, 0.08)',
    'border-strong': 'rgba(0, 0, 0, 0.14)',
    text: '#111114',
    'text-2': '#52525b',
    'text-3': '#6b6b74',
    accent: '#e5483d',
    'accent-fill': '#cf3a30',
    'accent-fill-hover': '#bf342b',
    'accent-soft': 'rgba(229, 72, 61, 0.10)',
    'on-accent': '#ffffff',
    focus: '#cf3a30',
    'control-off': '#8a8a93',
    'glow-1': 'rgba(229, 72, 61, 0.08)',
    'glow-2': 'rgba(90, 100, 230, 0.06)',
    shadow: '0 1px 2px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.08)',
    'logo-bg': '#111114',
    'logo-fg': '#fafaf9',
  },
};

export const FONT_STACK =
  '"Inter", "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO_STACK = '"JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, "Roboto Mono", monospace';

/** CSS text declaring the tokens of a theme as custom properties for a selector. */
export function tokensCss(selector: string, tokens: ThemeTokens): string {
  const body = Object.entries(tokens)
    .map(([k, v]) => `  --mt-${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n  --mt-font: ${FONT_STACK};\n  --mt-mono: ${MONO_STACK};\n}`;
}

/** Both themes, switched by a data-theme attribute on the given scope selector. */
export function themedTokensCss(scope: string): string {
  return [
    tokensCss(`${scope}, ${scope}[data-theme="dark"]`, TOKENS.dark),
    tokensCss(`${scope}[data-theme="light"]`, TOKENS.light),
  ].join('\n');
}

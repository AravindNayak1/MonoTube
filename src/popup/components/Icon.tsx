import { LOGO, LOGO_MARK_PATH } from '../../shared/brand';

/** Stroke icons on a 24×24 grid (Lucide-style geometry), drawn in currentColor. */
export const ICON_PATHS = {
  power: ['M12 2v10', 'M18.4 6.6a9 9 0 1 1-12.77.04'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  monitor: ['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M8 21h8', 'M12 17v4'],
  rotateCcw: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  arrowUpRight: ['M7 7h10v10', 'M7 17 17 7'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 8v4', 'M12 16h.01'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.75, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The monochrome MonoTube mark: squircle with the play triangle cut out (even-odd fill). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox={LOGO.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={LOGO_MARK_PATH} fillRule="evenodd" />
    </svg>
  );
}

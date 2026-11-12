import { useId } from 'react';
import type { Settings } from '../../shared/settings';
import type { ToggleKey } from '../hooks/useSettings';
import { Switch } from './Switch';

type FeatureKey = Exclude<ToggleKey, 'enabled'>;

interface Feature {
  key: FeatureKey;
  title: string;
  description: string;
}

/** The Focus features, in display order. Descriptions are kept to one line at 360px. */
const FEATURES: readonly Feature[] = [
  { key: 'blockRecommendations', title: 'Block recommendations', description: 'Replace the feed, hide suggestions' },
  { key: 'blockShorts', title: 'Block Shorts', description: 'Hide Shorts and stop Shorts links' },
  { key: 'disableAutoplay', title: 'Disable autoplay', description: 'Never roll on to the next video' },
  { key: 'hideEndScreens', title: 'Hide end screens', description: 'No video wall, end cards or info cards' },
  { key: 'adFiltering', title: 'Ad & tracker filtering', description: 'Filter ad and tracker requests' },
  { key: 'hideComments', title: 'Hide comments', description: 'Hide the comments under videos' },
];

interface FocusGroupProps {
  settings: Settings;
  onToggle: (key: FeatureKey, value: boolean) => void;
}

/** Feature switches. While MonoTube is paused they keep showing their values but are dimmed and disabled. */
export function FocusGroup({ settings, onToggle }: FocusGroupProps) {
  const headingId = useId();
  const paused = !settings.enabled;

  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section-head">
        <h2 className="section-label" id={headingId}>
          Focus
        </h2>
        {paused && <span className="section-note">Off while paused</span>}
      </div>
      <div className="card list" data-disabled={paused || undefined}>
        {FEATURES.map((f) => (
          <FeatureRow
            key={f.key}
            feature={f}
            checked={settings[f.key]}
            disabled={paused}
            onChange={(value) => onToggle(f.key, value)}
          />
        ))}
      </div>
    </section>
  );
}

interface FeatureRowProps {
  feature: Feature;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function FeatureRow({ feature, checked, disabled, onChange }: FeatureRowProps) {
  const id = useId();
  const switchId = `${id}switch`;
  const titleId = `${id}title`;
  const descId = `${id}desc`;

  return (
    <div className="row" data-disabled={disabled || undefined}>
      {/* A label pointing at the button makes the whole text area a click target. */}
      <label className="row-text" htmlFor={switchId}>
        <span className="row-title" id={titleId}>
          {feature.title}
        </span>
        <span className="row-desc" id={descId}>
          {feature.description}
        </span>
      </label>
      <Switch
        id={switchId}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        testId={`toggle-${feature.key}`}
        labelledBy={titleId}
        describedBy={descId}
      />
    </div>
  );
}

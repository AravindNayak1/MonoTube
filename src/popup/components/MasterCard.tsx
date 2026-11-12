import { useId } from 'react';
import { BRAND } from '../../shared/brand';
import { Icon } from './Icon';
import { Switch } from './Switch';

interface MasterCardProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/** The master switch. Clicking anywhere on the text toggles it too (label → button). */
export function MasterCard({ enabled, onChange }: MasterCardProps) {
  const id = useId();
  const switchId = `${id}switch`;
  const titleId = `${id}title`;
  const descId = `${id}desc`;

  return (
    <section className="card master" data-on={enabled || undefined} aria-label="MonoTube">
      <span className="master-icon" aria-hidden="true">
        <Icon name="power" size={18} strokeWidth={2} />
      </span>
      <label className="master-text" htmlFor={switchId}>
        <span className="master-title" id={titleId}>
          Enable MonoTube
        </span>
        <span className="master-desc" id={descId}>
          {enabled ? BRAND.motto : 'Paused. YouTube is untouched.'}
        </span>
      </label>
      <Switch
        id={switchId}
        checked={enabled}
        onChange={onChange}
        testId="toggle-enabled"
        labelledBy={titleId}
        describedBy={descId}
      />
    </section>
  );
}

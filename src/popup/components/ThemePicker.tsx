import { useId, useRef, type KeyboardEvent } from 'react';
import type { ThemePreference } from '../../shared/settings';
import { Icon, type IconName } from './Icon';

const OPTIONS: readonly { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

interface ThemePickerProps {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}

/**
 * Segmented control implemented as an ARIA radio group: one tab stop (the checked option),
 * arrow keys / Home / End move the selection, as native radio buttons do.
 */
export function ThemePicker({ value, onChange }: ThemePickerProps) {
  const labelId = useId();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    OPTIONS.findIndex((o) => o.value === value),
  );

  const select = (index: number) => {
    const option = OPTIONS[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    optionRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = OPTIONS.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: selected === last ? 0 : selected + 1,
      ArrowDown: selected === last ? 0 : selected + 1,
      ArrowLeft: selected === 0 ? last : selected - 1,
      ArrowUp: selected === 0 ? last : selected - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div className="card appearance">
      <span className="appearance-label" id={labelId}>
        Appearance
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown}>
        <span
          className="segmented-thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${selected * 100}%)` }}
        />
        {OPTIONS.map((option, index) => {
          const checked = index === selected;
          return (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="segmented-option"
              data-testid={`theme-${option.value}`}
              onClick={() => select(index)}
            >
              <Icon name={option.icon} size={14} />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

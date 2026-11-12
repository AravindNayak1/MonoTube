interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Value for data-testid, e.g. "toggle-blockShorts". */
  testId: string;
  id?: string;
  disabled?: boolean;
  /** id of the element naming the switch (preferred over `label`). */
  labelledBy?: string;
  /** id of the element describing the switch. */
  describedBy?: string;
  /** Accessible name when there is no visible label to point at. */
  label?: string;
}

/**
 * Accessible on/off switch: a native button (Space/Enter work out of the box) exposed as
 * role="switch" with aria-checked. Styling lives in popup.css (.switch).
 */
export function Switch({ checked, onChange, testId, id, disabled, labelledBy, describedBy, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}

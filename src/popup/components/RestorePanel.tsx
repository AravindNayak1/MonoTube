import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MSG, type RestoreResult } from '../../shared/constants';
import { Icon } from './Icon';

type Phase = 'idle' | 'confirm' | 'working';

interface Result {
  ok: boolean;
  message: string;
}

/**
 * The service worker answers MSG.restore with a RestoreResult. Read defensively: anything that is
 * not an explicit failure counts as success, and the tab count is shown only when provided.
 */
type RestoreResponse = Partial<RestoreResult>;

function tabsSentence(count: number): string {
  if (count === 0) return 'No YouTube tabs were open.';
  return `Reloaded ${count} YouTube tab${count === 1 ? '' : 's'}.`;
}

async function requestRestore(): Promise<Result> {
  let response: RestoreResponse | undefined;
  try {
    response = (await chrome.runtime.sendMessage({ type: MSG.restore })) as RestoreResponse | undefined;
  } catch (err) {
    console.warn('MonoTube: restore request failed', err);
    return { ok: false, message: 'Couldn’t reach MonoTube’s background service. Please try again.' };
  }
  if (response?.ok === false || typeof response?.error === 'string') {
    return { ok: false, message: `Couldn’t restore YouTube: ${response.error ?? 'unknown error'}.` };
  }
  const count = typeof response?.reloadedTabs === 'number' ? ` ${tabsSentence(response.reloadedTabs)}` : '';
  return { ok: true, message: `Original YouTube restored.${count}` };
}

/**
 * "Restore original YouTube": a disclosure button that expands an inline confirmation.
 * Confirming asks the service worker to turn MonoTube off, switch YouTube's autoplay back on and
 * reload YouTube tabs; the outcome is announced in a live region under the button.
 */
export function RestorePanel() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousPhase = useRef<Phase>(phase);
  const panelId = useId();
  const textId = useId();

  useEffect(() => {
    const was = previousPhase.current;
    previousPhase.current = phase;
    if (phase === 'confirm' && was === 'idle') {
      // The popup may need to scroll to show the confirmation.
      panelRef.current?.scrollIntoView({ block: 'nearest' });
    } else if (phase === 'idle' && was === 'working') {
      // The focused confirm button just unmounted; keep keyboard focus somewhere sensible.
      triggerRef.current?.focus();
    }
  }, [phase]);

  const open = () => {
    setResult(null);
    setPhase('confirm');
  };

  const cancel = () => {
    setPhase('idle');
    triggerRef.current?.focus();
  };

  const confirm = async () => {
    setPhase('working');
    const outcome = await requestRestore();
    setResult(outcome);
    setPhase('idle');
  };

  // On the whole section: focus is usually still on the trigger while the confirmation is open.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && phase === 'confirm') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  const expanded = phase !== 'idle';

  return (
    <section className="restore" aria-label="Restore" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-block"
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={phase === 'working'}
        data-testid="restore"
        onClick={() => (expanded ? cancel() : open())}
      >
        <Icon name="rotateCcw" size={15} />
        Restore original YouTube
      </button>

      {expanded && (
        <div
          ref={panelRef}
          id={panelId}
          className="confirm"
          role="group"
          aria-labelledby={textId}
          aria-busy={phase === 'working'}
        >
          <p className="confirm-text" id={textId}>
            Turns MonoTube off, switches YouTube autoplay back on and reloads open YouTube tabs.
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn btn-sm" onClick={cancel} disabled={phase === 'working'}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              data-testid="restore-confirm"
              disabled={phase === 'working'}
              onClick={() => void confirm()}
            >
              {phase === 'working' ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </div>
      )}

      {/* Always mounted so screen readers announce the outcome when it appears. */}
      <p className="restore-result" role="status" data-tone={result ? (result.ok ? 'ok' : 'error') : undefined}>
        {result && (
          <>
            <Icon name={result.ok ? 'check' : 'alert'} size={14} strokeWidth={2} />
            <span>{result.message}</span>
          </>
        )}
      </p>
    </section>
  );
}

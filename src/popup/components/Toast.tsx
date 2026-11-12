import { useEffect } from 'react';
import { Icon } from './Icon';

const TOAST_MS = 4000;

/** Transient error notice pinned to the bottom of the popup (does not shift the layout). */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="toast-region" role="alert">
      {message && (
        <div className="toast">
          <Icon name="alert" size={15} strokeWidth={2} />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

import { X } from 'lucide-react';
import { useToasts } from '../../app/toasts';

/** Undo toasts and short messages: a polite live region. Dark in both themes. */
export function ToastRegion() {
  const { toasts, act, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      role="region"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex flex-col items-center gap-2 px-4 lg:bottom-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className="pointer-events-auto flex min-h-14 w-full max-w-sm items-center gap-2 rounded-xl bg-toast-bg py-1 pl-5 pr-1 text-toast-text"
        >
          <span className="flex-1 text-body">{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-md px-3 font-semibold text-toast-action"
              onClick={() => {
                act(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md text-toast-text"
            aria-label="Dismiss"
            onClick={() => {
              dismiss(toast.id);
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

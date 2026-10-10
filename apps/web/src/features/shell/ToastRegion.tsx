import { useToasts } from '../../app/toasts';

/** Undo toasts and other short messages. A polite live region, so they are announced. */
export function ToastRegion() {
  const { toasts, act, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      role="region"
      className="fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className="flex w-full max-w-md flex-wrap items-center gap-2 rounded border bg-[Canvas] p-2"
        >
          <span className="flex-1">{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                act(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            type="button"
            className="btn"
            aria-label="Dismiss"
            onClick={() => {
              dismiss(toast.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

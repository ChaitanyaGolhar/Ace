import { useUpdateBanner } from './useUpdateBanner';

/**
 * Non-blocking: a new version is ready, or the server needs one to sync (§6.6). It
 * reloads only when the user taps Reload; studying keeps working meanwhile.
 */
export function UpdateBanner() {
  const vm = useUpdateBanner();
  if (!vm.visible) return null;
  return (
    <div
      role="status"
      data-testid="update-banner"
      className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center justify-center gap-2 border-b border-border bg-surface-raised px-4 py-1.5 text-small"
    >
      <span>{vm.message}</span>
      <button type="button" className="btn-primary" onClick={vm.reload}>
        Reload
      </button>
      <button type="button" className="btn-ghost" onClick={vm.dismiss}>
        Later
      </button>
    </div>
  );
}

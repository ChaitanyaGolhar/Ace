import { useUpdateBanner } from './useUpdateBanner';

/** Non-blocking: a new version is ready; it reloads only when the user taps Reload. */
export function UpdateBanner() {
  const vm = useUpdateBanner();
  if (!vm.visible) return null;
  return (
    <div
      role="status"
      data-testid="update-banner"
      className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center justify-center gap-3 border-b border-border bg-surface-raised px-4 py-2 text-body"
    >
      <span>Update available — reload</span>
      <button type="button" className="btn-primary min-h-11" onClick={vm.reload}>
        Reload
      </button>
      <button type="button" className="btn-ghost" onClick={vm.dismiss}>
        Later
      </button>
    </div>
  );
}

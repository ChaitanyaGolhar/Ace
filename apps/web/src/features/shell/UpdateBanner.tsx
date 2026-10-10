import { useUpdateBanner } from './useUpdateBanner';

export function UpdateBanner() {
  const vm = useUpdateBanner();
  if (!vm.visible) return null;
  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex flex-wrap items-center gap-2 border-b p-2"
    >
      <span>Update available — reload</span>
      <button type="button" className="btn" onClick={vm.reload}>
        Reload
      </button>
      <button type="button" className="btn" onClick={vm.dismiss}>
        Later
      </button>
    </div>
  );
}

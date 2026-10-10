import { RotateCcw } from 'lucide-react';

/** Mark + wordmark. The mark is a ring with a "come back" arrow, in the accent colour. */
export function Logo({ withWordmark = true }: { withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span
        aria-hidden="true"
        className="inline-flex size-8 items-center justify-center rounded-full border-2 border-accent text-text"
      >
        <RotateCcw className="size-4" strokeWidth={2.5} />
      </span>
      {withWordmark && <span className="text-section font-semibold text-text">Recall</span>}
    </span>
  );
}

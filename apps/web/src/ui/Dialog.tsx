import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Bottom sheet on small screens, centred dialog from 1024px. */
  testId?: string;
}

/**
 * Modal built on the native <dialog>: `showModal()` makes the rest of the page inert
 * (focus stays inside) and Esc closes it, with no extra library. On open, focus goes to
 * the element marked `data-autofocus` (else the first focusable one).
 */
export function Dialog({ open, onClose, title, children, testId }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React's autoFocus only runs when an element mounts, and the dialog's content
      // mounts long before it opens. Mark the safe default with data-autofocus instead.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none rounded-t-xl border border-border bg-surface-raised p-0 text-text backdrop:bg-scrim lg:inset-0 lg:m-auto lg:max-w-md lg:rounded-xl"
    >
      <div className="flex flex-col gap-4 p-6 pt-3 lg:pt-6">
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border lg:hidden" />
        <h2 id={titleId} className="text-card font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

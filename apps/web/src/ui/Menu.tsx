import { Ellipsis } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * "⋯" options menu: a button that opens a list of actions. Esc or a click outside
 * closes it; arrow keys move between items; focus returns to the button.
 */
export function Menu({
  label,
  items,
  buttonClassName = 'icon-btn',
}: {
  label: string;
  items: MenuItem[];
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col rounded-lg border border-border bg-surface-raised p-1"
          onKeyDown={(e) => {
            const items = [
              ...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
            ];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              items[(index + 1) % items.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              items[(index - 1 + items.length) % items.length]?.focus();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`flex min-h-11 items-center rounded-md px-3 text-left text-body hover:bg-surface ${item.danger ? 'text-error' : 'text-text'}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

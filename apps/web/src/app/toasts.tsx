import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ShowToast {
  message: string;
  action?: { label: string; onAction: () => void };
  /** Called when the toast closes without its action (dismissed or timed out). */
  onClose?: () => void;
  durationMs?: number;
}

/** What the toast region renders. Callbacks stay in the provider. */
export interface ToastView {
  id: number;
  message: string;
  actionLabel: string | null;
}

interface ToastApi {
  toasts: ToastView[];
  show: (toast: ShowToast) => void;
  /** The user pressed the toast's action button (e.g. Undo). */
  act: (id: number) => void;
  /** The user dismissed it. */
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastView[]>([]);
  // Callbacks and timers live in a ref, so closing a toast runs its callback exactly
  // once (state updaters may run twice in StrictMode and must stay pure).
  const live = useRef(
    new Map<number, { input: ShowToast; timer: ReturnType<typeof setTimeout> }>(),
  );
  const nextId = useRef(1);

  const close = useCallback((id: number, viaAction: boolean) => {
    const entry = live.current.get(id);
    if (!entry) return;
    live.current.delete(id);
    clearTimeout(entry.timer);
    setToasts((list) => list.filter((t) => t.id !== id));
    if (viaAction) entry.input.action?.onAction();
    else entry.input.onClose?.();
  }, []);

  const show = useCallback(
    (input: ShowToast) => {
      const id = nextId.current++;
      const timer = setTimeout(() => {
        close(id, false);
      }, input.durationMs ?? 5000);
      live.current.set(id, { input, timer });
      setToasts((list) => [
        ...list,
        { id, message: input.message, actionLabel: input.action?.label ?? null },
      ]);
    },
    [close],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toasts,
      show,
      act: (id) => {
        close(id, true);
      },
      dismiss: (id) => {
        close(id, false);
      },
    }),
    [toasts, show, close],
  );

  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToasts must be used inside <ToastProvider>');
  return api;
}

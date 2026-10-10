type Listener = (keys: ReadonlySet<string>) => void;

/**
 * Actions that run after a delay unless cancelled: the mechanism behind undo toasts.
 * Deleting a card writes a tombstone, and tombstones can never be cleared (invariant
 * 9), so "undo" works by not writing it yet. Cancelling = undo; the timer firing (or
 * flushAll, when the user leaves) = the delete really happens.
 */
export class PendingActions {
  private readonly pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; action: () => Promise<void> }
  >();
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly delayMs: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  schedule(key: string, action: () => Promise<void>): void {
    this.clear(key);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.notify();
      action().catch(this.onError);
    }, this.delayMs);
    this.pending.set(key, { timer, action });
    this.notify();
  }

  /** Returns true if there was a pending action to cancel. */
  cancel(key: string): boolean {
    const had = this.clear(key);
    if (had) this.notify();
    return had;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  /** Runs one pending action now (e.g. its toast was dismissed). */
  async flush(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.clear(key);
    this.notify();
    await entry.action().catch(this.onError);
  }

  /** Runs every pending action now. */
  async flushAll(): Promise<void> {
    const actions = [...this.pending.values()].map((p) => p.action);
    for (const key of [...this.pending.keys()]) this.clear(key);
    this.notify();
    await Promise.all(actions.map((action) => action().catch(this.onError)));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clear(key: string): boolean {
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    return true;
  }

  private notify(): void {
    const keys = new Set(this.pending.keys());
    for (const listener of this.listeners) listener(keys);
  }
}

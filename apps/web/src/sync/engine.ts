import { setMeta, getMeta } from '../db/meta';
import type { AppContext } from '../services/context';
import { recordEvent } from '../services/events';
import type { SyncStatus } from '../services/syncStatus';
import { syncOnce } from './syncOnce';
import { AuthError, UpgradeRequiredError, type SyncTransport } from './transport';

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

export interface SyncEngineDeps {
  ctx: AppContext;
  transport: SyncTransport;
  /** navigator.onLine, injected for tests. */
  isOnline: () => boolean;
}

type Listener = (status: SyncStatus) => void;

/**
 * Runs sync rounds (§8.4): only while signed in, one at a time (an in-memory mutex),
 * with exponential backoff after failures (5 s → 10 s → … → 5 min). A failure never
 * touches local data, so studying is never blocked by sync.
 */
export class SyncEngine {
  private status: SyncStatus = { kind: 'signedOut' };
  private isSignedIn = false;
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay: number | null = null;
  /** Set by a 426: this app version can't sync any more, until the page is reloaded. */
  private outdated = false;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly deps: SyncEngineDeps) {}

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Delay before the scheduled retry, or null if none is scheduled. */
  nextRetryDelay(): number | null {
    return this.retryDelay;
  }

  /** App start: use the cached sign-in state (works offline) and sync if signed in. */
  async start(): Promise<void> {
    const auth = await getMeta(this.deps.ctx.db, 'auth');
    this.isSignedIn = auth?.signedIn ?? false;
    if (!this.isSignedIn) {
      this.setStatus({ kind: 'signedOut' });
      return;
    }
    await this.requestSync();
  }

  /** Asks the API who is signed in (e.g. after the magic-link redirect) and syncs. */
  async refreshAuth(): Promise<void> {
    try {
      const me = await this.deps.transport.me();
      if (me) await this.signedInAs(me);
      else await this.markSignedOut();
    } catch {
      // Offline or server down: keep the cached state; start() decides what to do.
      await this.start();
    }
  }

  async signedIn(user: { id: string; email: string }): Promise<void> {
    await this.signedInAs(user);
  }

  async signOut(): Promise<void> {
    try {
      await this.deps.transport.logout();
    } catch {
      // Offline: the session expires on its own; locally we are signed out either way.
    }
    await this.markSignedOut();
  }

  /**
   * Runs a sync now. If one is already running, the caller waits for it plus exactly one
   * more round (so changes made in the meantime are included).
   */
  requestSync(): Promise<void> {
    if (!this.isSignedIn || this.outdated) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.shouldRunAgain());
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Resolves when no sync is running (for tests and for "Sync now" feedback). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  stop(): void {
    this.clearRetry();
  }

  /** Read through a method: TypeScript can't see `again` change during the awaited round. */
  private shouldRunAgain(): boolean {
    return this.again && this.isSignedIn && !this.outdated;
  }

  private async signedInAs(user: { email: string }): Promise<void> {
    const before = await getMeta(this.deps.ctx.db, 'auth');
    if (!before?.signedIn) await recordEvent(this.deps.ctx, 'signed_in', {});
    await setMeta(this.deps.ctx.db, 'auth', { signedIn: true, email: user.email });
    this.isSignedIn = true;
    await this.requestSync();
  }

  private async markSignedOut(): Promise<void> {
    this.isSignedIn = false;
    this.clearRetry();
    await setMeta(this.deps.ctx.db, 'auth', { signedIn: false, email: null });
    this.setStatus({ kind: 'signedOut' });
  }

  private async runOnce(): Promise<void> {
    this.clearRetry();
    this.setStatus({ kind: 'syncing' });
    try {
      await syncOnce(this.deps.ctx, this.deps.transport);
      this.failures = 0;
      this.setStatus({ kind: 'synced', at: this.deps.ctx.now() });
    } catch (error) {
      if (error instanceof AuthError) {
        await this.markSignedOut();
        return;
      }
      if (error instanceof UpgradeRequiredError) {
        // No retries: only a newer version of the app can sync. Studying goes on offline.
        this.outdated = true;
        this.setStatus({ kind: 'updateRequired' });
        return;
      }
      this.failures += 1;
      this.retryDelay = Math.min(FIRST_RETRY_MS * 2 ** (this.failures - 1), MAX_RETRY_MS);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.requestSync();
      }, this.retryDelay);
      this.setStatus(this.deps.isOnline() ? { kind: 'error' } : { kind: 'offline' });
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = null;
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}

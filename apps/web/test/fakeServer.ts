import {
  lww,
  mergeLog,
  type Card,
  type Deck,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type ReviewLog,
} from '@recall/core';
import { AuthError, NetworkError, type SyncTransport } from '../src/sync/transport';

/**
 * An in-memory stand-in for the sync API, for fast engine tests. It applies the same
 * core rules as the real server (lww, mergeLog, one global seq). The real API is
 * exercised by the integration tests.
 */
export class FakeServer {
  private seq = 0;
  readonly decks = new Map<string, { row: Deck; seq: number }>();
  readonly cards = new Map<string, { row: Card; seq: number }>();
  readonly logs = new Map<string, { row: ReviewLog; seq: number }>();
  readonly calls: string[] = [];
  pushes: PushRequest[] = [];

  push(req: PushRequest): PushResponse {
    this.pushes.push(req);
    for (const d of req.decks) {
      const stored = this.decks.get(d.id);
      const winner = stored ? lww(stored.row, d) : d;
      if (!stored || JSON.stringify(winner) !== JSON.stringify(stored.row)) {
        this.decks.set(d.id, { row: winner, seq: ++this.seq });
      }
    }
    for (const c of req.cards) {
      const stored = this.cards.get(c.id);
      const winner = stored ? lww(stored.row, c) : c;
      if (!stored || JSON.stringify(winner) !== JSON.stringify(stored.row)) {
        this.cards.set(c.id, { row: winner, seq: ++this.seq });
      }
    }
    for (const l of req.reviewLogs) {
      const stored = this.logs.get(l.id);
      if (!stored) {
        this.logs.set(l.id, { row: l, seq: ++this.seq });
      } else {
        const merged = mergeLog(stored.row, l);
        if (merged.voidedAt !== stored.row.voidedAt) {
          this.logs.set(l.id, {
            row: { ...stored.row, voidedAt: merged.voidedAt },
            seq: ++this.seq,
          });
        }
      }
    }
    return {
      accepted: {
        decks: req.decks.map((d) => d.id),
        cards: req.cards.map((c) => c.id),
        reviewLogs: req.reviewLogs.map((l) => l.id),
      },
    };
  }

  pull(since: string, limit: number): PullResponse {
    const after = Number(since);
    const all = [
      ...[...this.decks.values()].map((v) => ({ ...v, kind: 'deck' as const })),
      ...[...this.cards.values()].map((v) => ({ ...v, kind: 'card' as const })),
      ...[...this.logs.values()].map((v) => ({ ...v, kind: 'log' as const })),
    ]
      .filter((v) => v.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    return {
      decks: page.filter((v) => v.kind === 'deck').map((v) => v.row),
      cards: page.filter((v) => v.kind === 'card').map((v) => v.row),
      reviewLogs: page.filter((v) => v.kind === 'log').map((v) => v.row),
      nextCursor: String(page.at(-1)?.seq ?? after),
      hasMore: all.length > limit,
    };
  }
}

export interface FakeTransportOptions {
  /** Runs after the push request is built, before the server applies it (in flight). */
  duringPush?: () => Promise<void>;
  fail?: 'network' | 'auth' | null;
  user?: { id: string; email: string } | null;
}

export function fakeTransport(
  server: FakeServer,
  options: FakeTransportOptions = {},
): SyncTransport & { options: FakeTransportOptions } {
  const check = () => {
    if (options.fail === 'network') throw new NetworkError('offline');
    if (options.fail === 'auth') throw new AuthError();
  };
  return {
    options,
    async push(body) {
      server.calls.push('push');
      check();
      await options.duringPush?.();
      return server.push(structuredClone(body));
    },
    pull(since, limit) {
      server.calls.push('pull');
      check();
      return Promise.resolve(structuredClone(server.pull(since, limit)));
    },
    me() {
      check();
      return Promise.resolve(
        options.user === undefined ? { id: 'u1', email: 'a@example.com' } : options.user,
      );
    },
    logout() {
      return Promise.resolve();
    },
  };
}

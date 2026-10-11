import {
  EVENTS_VERSION,
  PROTOCOL_VERSION,
  PullResponseSchema,
  PushResponseSchema,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '@recall/core';

/** The session is missing or expired (401). Studying goes on; sync shows "signed out". */
export class AuthError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'AuthError';
  }
}

/** The request never got an answer (offline, server down, CORS…). */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The server refused this version of the app (426, §6.6): it must be reloaded to sync. */
export class UpgradeRequiredError extends Error {
  constructor() {
    super('This version of the app is out of date');
    this.name = 'UpgradeRequiredError';
  }
}

/** The server answered with an error. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Server error ${String(status)} (${code})`);
    this.name = 'ServerError';
  }
}

/** What the sync engine needs from the API. Injectable, so tests can use a fake. */
export interface SyncTransport {
  push: (body: PushRequest) => Promise<PushResponse>;
  pull: (since: string, limit: number) => Promise<PullResponse>;
  /** The signed-in user, or null if the session is missing/expired. */
  me: () => Promise<{ id: string; email: string } | null>;
  logout: () => Promise<void>;
}

/** The real transport: fetch with the session cookie (`credentials: 'include'`). */
export function httpTransport(apiUrl: string, fetchFn: typeof fetch): SyncTransport {
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchFn(`${apiUrl}${path}`, { credentials: 'include', ...init });
    } catch (error) {
      throw new NetworkError(error instanceof Error ? error.message : 'network error');
    }
    if (res.status === 401) throw new AuthError();
    if (res.status === 426) throw new UpgradeRequiredError();
    if (!res.ok) {
      let code = 'unknown';
      try {
        code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? code;
      } catch {
        // Not JSON; keep 'unknown'.
      }
      throw new ServerError(res.status, code);
    }
    return res;
  };

  return {
    async push(body) {
      const res = await call('/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return PushResponseSchema.parse(await res.json());
    },
    async pull(since, limit) {
      // Pulls declare the protocol too (M7): the server refuses old apps with 426. And
      // the event types this app can parse (D-348): it gets no others.
      const params = new URLSearchParams({
        since,
        limit: String(limit),
        protocolVersion: String(PROTOCOL_VERSION),
        eventsVersion: String(EVENTS_VERSION),
      });
      const res = await call(`/sync/pull?${params.toString()}`);
      return PullResponseSchema.parse(await res.json());
    },
    async me() {
      try {
        const res = await call('/me');
        return (await res.json()) as { id: string; email: string };
      } catch (error) {
        if (error instanceof AuthError) return null;
        throw error;
      }
    },
    async logout() {
      await call('/auth/logout', { method: 'POST' });
    },
  };
}

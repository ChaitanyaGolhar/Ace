export type SyncStatus =
  | { kind: 'synced'; at: number }
  | { kind: 'syncing' }
  | { kind: 'offline' }
  | { kind: 'error' }
  | { kind: 'signedOut' };

export interface SyncStatusView {
  /** Which icon to draw; the words always carry the meaning too. */
  icon: SyncStatus['kind'];
  text: string;
  /** Link text after the status, if any ("Sign in to sync"). */
  action: string | null;
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${String(m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${String(h)} h ago`;
  return `${String(Math.round(h / 24))} d ago`;
}

export function syncStatusView(status: SyncStatus, now: number): SyncStatusView {
  switch (status.kind) {
    case 'synced':
      return { icon: 'synced', text: `Synced · ${relativeTime(status.at, now)}`, action: null };
    case 'syncing':
      return { icon: 'syncing', text: 'Syncing…', action: null };
    case 'offline':
      return { icon: 'offline', text: 'Offline · saved on this device', action: null };
    case 'error':
      return { icon: 'error', text: 'Couldn’t sync · retrying', action: null };
    case 'signedOut':
      return { icon: 'signedOut', text: 'On this device only', action: 'Sign in to sync' };
  }
}

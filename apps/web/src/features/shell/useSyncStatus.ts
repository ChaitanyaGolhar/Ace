import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { syncStatusView, type SyncStatusView } from '../../services/syncStatus';

/** The live sync status as icon + words. Re-renders so "Synced · 5 min ago" stays true. */
export function useSyncStatus(): SyncStatusView {
  const { ctx, sync } = useServices();
  const [status, setStatus] = useState(() => sync.getStatus());
  const [, setTick] = useState(0);

  useEffect(() => {
    setStatus(sync.getStatus());
    return sync.subscribe(setStatus);
  }, [sync]);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, []);

  return syncStatusView(status, ctx.now());
}

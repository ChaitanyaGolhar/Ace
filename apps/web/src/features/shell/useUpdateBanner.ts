import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useServices } from '../../app/services';

export interface UpdateBannerViewModel {
  /** A new version is waiting, or the server needs a newer one to sync (426). */
  visible: boolean;
  /** "Update available — reload" or, after a 426, "Update required to sync". */
  message: string;
  /** Activates the new version and reloads. Only ever called by the user. */
  reload: () => void;
  dismiss: () => void;
}

/** The waiting service worker once a new one has installed (up to 15 s), or null. */
function waitForWaiting(reg: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  if (reg.waiting) return Promise.resolve(reg.waiting);
  const installing = reg.installing;
  if (!installing) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(reg.waiting);
    }, 15_000);
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' || installing.state === 'redundant') {
        clearTimeout(timer);
        resolve(reg.waiting);
      }
    });
  });
}

export function useUpdateBanner(): UpdateBannerViewModel {
  const { sync } = useServices();
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registration.current = r;
    },
  });
  const [required, setRequired] = useState(sync.getStatus().kind === 'updateRequired');
  const [dismissed, setDismissed] = useState(false);

  useEffect(
    () =>
      sync.subscribe((status) => {
        setRequired(status.kind === 'updateRequired');
      }),
    [sync],
  );

  return {
    visible: needRefresh || (required && !dismissed),
    message: required ? 'Update required to sync' : 'Update available — reload',
    reload: () => {
      if (needRefresh) {
        void updateServiceWorker(true);
        return;
      }
      // §6.6: the server refused this version. Look for the new one, then switch to it.
      // A plain reload isn't enough: the new service worker would still be waiting, and
      // the page would come back on the old version (found in the M7 deploy).
      const reg = registration.current;
      if (!reg) {
        window.location.reload();
        return;
      }
      void reg
        .update()
        .then(() => waitForWaiting(reg))
        .then((waiting) => {
          if (waiting) void updateServiceWorker(true);
          else window.location.reload();
        })
        .catch(() => {
          window.location.reload();
        });
    },
    dismiss: () => {
      setNeedRefresh(false);
      setDismissed(true);
    },
  };
}

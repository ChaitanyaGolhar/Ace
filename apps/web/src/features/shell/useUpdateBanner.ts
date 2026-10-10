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
      // §6.6: the server refused this version. Look for the new one, then reload into it.
      const check = registration.current?.update() ?? Promise.resolve();
      void check.finally(() => {
        window.location.reload();
      });
    },
    dismiss: () => {
      setNeedRefresh(false);
      setDismissed(true);
    },
  };
}

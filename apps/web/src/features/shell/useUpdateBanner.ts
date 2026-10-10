import { useRegisterSW } from 'virtual:pwa-register/react';

export interface UpdateBannerViewModel {
  /** A new version of the app has been downloaded and is waiting. */
  visible: boolean;
  /** Activates the new version and reloads. Only ever called by the user. */
  reload: () => void;
  dismiss: () => void;
}

export function useUpdateBanner(): UpdateBannerViewModel {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  return {
    visible: needRefresh,
    reload: () => {
      void updateServiceWorker(true);
    },
    dismiss: () => {
      setNeedRefresh(false);
    },
  };
}

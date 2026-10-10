import { createContext, useContext, type ReactNode } from 'react';
import type { CatalogApi } from '../services/catalog';
import type { AppContext } from '../services/context';
import type { EntitlementsApi } from '../services/entitlements';
import type { PendingActions } from '../services/pendingActions';
import type { SyncEngine } from '../sync/engine';

/** Everything screens' hooks need: the service context plus app-wide helpers. */
export interface AppServices {
  ctx: AppContext;
  browserTimeZone: string;
  /** Delayed deletes behind undo toasts (shared, so they survive navigation). */
  pendingDeletes: PendingActions;
  /** Background sync (only active while signed in). */
  sync: SyncEngine;
  /** M7: the deck store's API. */
  catalog: CatalogApi;
  /** M8: unlock codes and entitlements. */
  entitlements: EntitlementsApi;
  /** Whether the browser thinks it's online (adding a store deck needs the network). */
  isOnline: () => boolean;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}

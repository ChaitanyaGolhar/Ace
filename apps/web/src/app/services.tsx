import { createContext, useContext, type ReactNode } from 'react';
import type { AppContext } from '../services/context';
import type { PendingActions } from '../services/pendingActions';

/** Everything screens' hooks need: the service context plus app-wide helpers. */
export interface AppServices {
  ctx: AppContext;
  browserTimeZone: string;
  /** Delayed deletes behind undo toasts (shared, so they survive navigation). */
  pendingDeletes: PendingActions;
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

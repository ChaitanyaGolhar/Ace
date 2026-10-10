import { useOutletContext } from 'react-router';

export type Chrome = 'full' | 'focused';

/** Lets a screen override the route's chrome (e.g. Home shows the welcome full-screen). */
export interface ChromeContext {
  setChrome: (chrome: Chrome | null) => void;
}

export function useChrome(): ChromeContext['setChrome'] {
  return useOutletContext<ChromeContext>().setChrome;
}

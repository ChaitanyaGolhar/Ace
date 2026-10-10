import { ChartColumn, Copy, House, Search, Settings } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useMatches } from 'react-router';
import { Logo } from '../../ui/Logo';
import { SyncStatusIcon, SyncStatusLine } from '../../ui/SyncStatus';
import type { Chrome, ChromeContext } from './chrome';
import { useShell } from './useShell';

/** Route `handle.chrome`: "focused" screens hide the mobile top bar and tab bar. */
export interface RouteHandle {
  chrome?: 'full' | 'focused';
}

const NAV = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/decks', label: 'Decks', Icon: Copy, end: false },
  { to: '/stats', label: 'Stats', Icon: ChartColumn, end: false },
] as const;

function sideLinkClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-11 items-center gap-3 rounded-lg px-3 text-body transition-colors duration-150 ${
    isActive ? 'bg-surface-raised font-medium text-text' : 'text-text-secondary hover:text-text'
  }`;
}

function tabLinkClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-meta ${
    isActive ? 'text-text' : 'text-text-secondary'
  }`;
}

/** One responsive shell: sidebar ≥1024px; top bar + bottom tab bar below that. */
export function Layout() {
  const vm = useShell();
  const matches = useMatches();
  const [override, setOverride] = useState<Chrome | null>(null);
  const chrome = override ?? (matches.at(-1)?.handle as RouteHandle | undefined)?.chrome ?? 'full';
  const outletContext: ChromeContext = { setChrome: setOverride };
  const mobileChrome = chrome === 'full';

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        aria-label="Sidebar"
        className="hidden w-[272px] shrink-0 border-r border-border lg:block"
      >
        <div className="sticky top-0 flex h-dvh flex-col px-4 py-6">
          <Link
            to="/"
            className="mb-8 inline-flex min-h-11 items-center px-2"
            aria-label="Recall home"
          >
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {NAV.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={sideLinkClass}>
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden="true"
                      className={`size-5 ${isActive ? 'text-accent' : ''}`}
                    />
                    <span className="flex-1">{label}</span>
                    {to === '/' && vm.todayCount !== null && vm.todayCount > 0 && (
                      <span
                        className="font-mono text-meta text-text-secondary"
                        aria-label={`${String(vm.todayCount)} to study`}
                      >
                        {vm.todayCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3">
            <NavLink to="/settings" className={sideLinkClass}>
              {({ isActive }) => (
                <>
                  <Settings
                    aria-hidden="true"
                    className={`size-5 ${isActive ? 'text-accent' : ''}`}
                  />
                  Settings
                </>
              )}
            </NavLink>
            <div className="px-3">
              <SyncStatusLine view={vm.sync} />
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {mobileChrome && (
          <header className="flex items-center gap-1 px-4 pt-3 lg:hidden">
            <Link
              to="/"
              className="inline-flex min-h-11 flex-1 items-center"
              aria-label="Recall home"
            >
              <Logo />
            </Link>
            <Link to="/settings" className="icon-btn" aria-label={`Sync status: ${vm.sync.text}`}>
              <SyncStatusIcon view={vm.sync} className="size-6" />
            </Link>
            <Link to="/search" className="icon-btn" aria-label="Search">
              <Search aria-hidden="true" className="size-6" />
            </Link>
          </header>
        )}

        <main
          className={`flex-1 px-4 lg:px-8 ${mobileChrome ? 'pb-28 pt-4' : 'pb-8'} lg:pb-12 lg:pt-12`}
        >
          <div className="mx-auto w-full max-w-[740px]">
            <Outlet context={outletContext} />
          </div>
        </main>

        {mobileChrome && (
          <nav
            aria-label="Tabs"
            className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] lg:hidden"
          >
            {[...NAV, { to: '/settings', label: 'Settings', Icon: Settings, end: false }].map(
              ({ to, label, Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={tabLinkClass}>
                  {({ isActive }) => (
                    <>
                      <Icon
                        aria-hidden="true"
                        className={`size-6 ${isActive ? 'text-accent' : ''}`}
                      />
                      {label}
                    </>
                  )}
                </NavLink>
              ),
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

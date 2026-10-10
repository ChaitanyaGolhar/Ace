import { NavLink, Outlet } from 'react-router';
import { ToastRegion } from './ToastRegion';
import { UpdateBanner } from './UpdateBanner';
import { useShell } from './useShell';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `link px-2 ${isActive ? 'font-bold' : ''}`;

export function Layout() {
  useShell();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <UpdateBanner />
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <nav aria-label="Main" className="flex flex-wrap gap-2">
          <NavLink to="/" end className={navLinkClass}>
            Home
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            Settings
          </NavLink>
        </nav>
      </header>
      <main className="flex-1 px-4 py-4 pb-28">
        <Outlet />
      </main>
      <ToastRegion />
    </div>
  );
}

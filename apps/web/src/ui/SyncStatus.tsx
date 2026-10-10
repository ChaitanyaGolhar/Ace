import { CircleAlert, CloudCheck, CloudOff, LogIn, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import type { SyncStatusView } from '../services/syncStatus';

const ICONS = {
  synced: { Icon: CloudCheck, className: 'text-success' },
  syncing: { Icon: RefreshCw, className: 'text-text-secondary' },
  offline: { Icon: CloudOff, className: 'text-warning' },
  error: { Icon: CircleAlert, className: 'text-error' },
  signedOut: { Icon: LogIn, className: 'text-text-secondary' },
} as const;

export function SyncStatusIcon({
  view,
  className = 'size-5',
}: {
  view: SyncStatusView;
  className?: string;
}) {
  const { Icon, className: tone } = ICONS[view.icon];
  return <Icon aria-hidden="true" className={`${className} shrink-0 ${tone}`} />;
}

/** Icon + words, never colour alone. */
export function SyncStatusLine({ view }: { view: SyncStatusView }) {
  return (
    <p className="flex items-start gap-2 text-meta text-text-secondary" data-testid="sync-status">
      <SyncStatusIcon view={view} className="mt-0.5 size-4" />
      <span>
        {view.text}
        {view.action && (
          <>
            {' · '}
            <Link to="/signin" className="text-link underline underline-offset-2">
              {view.action}
            </Link>
          </>
        )}
      </span>
    </p>
  );
}

import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { type Authenticity, authenticityReason } from '@/core/authenticity'
import { cn } from '@/lib/utils'

export function AuthenticityBadge({ authenticity: a }: { authenticity: Authenticity }) {
  const ok = a.status === 'verified'
  return (
    <span
      data-testid="authenticity"
      data-status={a.status}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        ok
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
      )}
    >
      {ok ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
      {ok ? `Verified Safe v${a.version}${a.l2 ? ' (L2)' : ''}` : 'Not verified: read-only'}
    </span>
  )
}

/** The explanation under the badge: why it's verified, or why it's read-only. */
export function AuthenticityDetails({ authenticity: a }: { authenticity: Authenticity }) {
  if (a.status === 'verified') {
    return (
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          The proxy's code matches a Safe proxy (factory {a.proxy.factories.join(', ')}), and its
          singleton's code matches {a.singletonName} v{a.version} from safe-deployments.
        </p>
        {a.versionMismatch !== undefined && (
          <p className="text-amber-700 dark:text-amber-400">
            VERSION() says "{a.versionMismatch}", which doesn't match the code. The code hash is
            what counts.
          </p>
        )}
      </div>
    )
  }
  return <p className="text-sm text-red-700 dark:text-red-400">{authenticityReason(a)}</p>
}

import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { CopyButton } from '@/components/address'
import { type Authenticity, authenticityReason } from '@/core/authenticity'
import { deployments } from '@/core/deployments'
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
    const rows = [
      ['Matching proxy runtime keccak256', a.proxy.codeHash],
      ['Matching singleton runtime keccak256', a.codeHash],
      ['Singleton address', a.singleton],
    ] as const
    return (
      <div className="flex min-w-0 flex-col gap-2 text-sm text-muted-foreground">
        <p>
          The proxy's code matches a Safe proxy (factory {a.proxy.factories.join(', ')}), and its
          singleton's code matches {a.singletonName} v{a.version} in the pinned deployment table
          derived from{' '}
          <a
            className="underline"
            href={`https://github.com/safe-global/safe-deployments/tree/${deployments.source.commit}`}
            target="_blank"
            rel="noreferrer"
          >
            safe-deployments {deployments.source.tag}
          </a>
          .
        </p>
        <dl className="flex min-w-0 flex-col gap-2" data-testid="authenticity-evidence">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs">{label}</dt>
              <dd className="flex min-w-0 items-start gap-1">
                <span className="min-w-0 font-mono text-xs break-all">{value}</span>
                <CopyButton value={value} label={`Copy ${label}`} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs">
          This proves code identity at the checked block only, based on RPC responses. It is not an
          audit and does not establish owner safety or independently verify RPC truthfulness.
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

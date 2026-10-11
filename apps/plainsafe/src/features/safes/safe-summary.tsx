// The facts about a Safe read at one pinned block (SPEC §3.2), as Add a Safe shows them.
import { formatUnits } from 'viem'
import { AddressView } from '@/components/address'
import { useChainName, useNativeCurrency } from '@/queries/settings'
import { AuthenticityBadge, AuthenticityDetails } from './authenticity-badge'
import type { SafeSnapshot } from './load-safe'

export function SafeFacts({ safe }: { safe: SafeSnapshot }) {
  const chainName = useChainName()
  const native = useNativeCurrency(safe.chainId)
  const verified = safe.authenticity.status === 'verified'
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AuthenticityBadge authenticity={safe.authenticity} />
          <span className="text-sm text-muted-foreground">
            {chainName(safe.chainId)} · as of block {safe.block.toString()}
          </span>
        </div>
        <AuthenticityDetails authenticity={safe.authenticity} />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Threshold</dt>
        <dd data-testid="threshold">
          {safe.threshold !== undefined && safe.owners
            ? `${safe.threshold} of ${safe.owners.length} owners`
            : 'unknown'}
        </dd>
        <dt className="text-muted-foreground">Nonce</dt>
        <dd data-testid="nonce">{safe.nonce?.toString() ?? 'unknown'}</dd>
        <dt className="text-muted-foreground">Balance</dt>
        <dd>
          {formatUnits(safe.balance, native.decimals)} {native.symbol}
        </dd>
        {safe.reportedVersion !== undefined && (
          <>
            <dt className="text-muted-foreground">VERSION()</dt>
            <dd>{safe.reportedVersion} (information only)</dd>
          </>
        )}
      </dl>
      {safe.owners && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            Owners{!verified && ' (unverified contract: may not mean anything)'}
          </h3>
          <ul className="flex flex-col gap-1" data-testid="owners">
            {safe.owners.map((o) => (
              <li key={o}>
                <AddressView chainId={safe.chainId} address={o} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

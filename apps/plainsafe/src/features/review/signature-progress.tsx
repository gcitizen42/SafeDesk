// Signature progress (SPEC §3.4 item 7): checked against the *current* owners (SPEC §5.3).
import { AddressView } from '@/components/address'
import { classifySigners, type RejectedSignature } from '@/core/package'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { cn } from '@/lib/utils'
import type { PackageSignature } from '@/schemas/package'

// A column narrow enough on a phone to leave the names room; "✓ approved onchain" wraps there
const STATUS = 'w-24 shrink-0 sm:w-36'

export function SignatureProgress(props: {
  chainId: number
  safe?: SafeSnapshot | undefined
  signatures: readonly PackageSignature[]
  rejected?: readonly RejectedSignature[]
  /** Owners who approved the hash onchain (approveHash, SPEC §5.2). */
  approvedBy?: readonly string[] | undefined
}) {
  const { safe, signatures } = props
  const { owners: valid, nonOwners } = classifySigners(signatures, safe?.owners)
  const signed = new Set(valid.map((s) => s.signer.toLowerCase()))
  const approved = new Set(
    (props.approvedBy ?? []).map((a) => a.toLowerCase()).filter((a) => !signed.has(a)),
  )
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" data-testid="signatures">
      <h2 className="font-medium">
        Signatures{' '}
        {safe?.threshold !== undefined && (
          <span data-testid="signature-count">
            {valid.length + approved.size} of {safe.threshold.toString()}
          </span>
        )}
      </h2>
      {!safe?.owners && <p className="text-sm text-muted-foreground">Owners not loaded yet.</p>}
      <ul className="flex flex-col gap-1.5 text-sm">
        {safe?.owners?.map((o) => (
          <li key={o} className="flex items-baseline gap-2">
            <span
              className={cn(
                STATUS,
                signed.has(o.toLowerCase()) || approved.has(o.toLowerCase())
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground',
              )}
            >
              {signed.has(o.toLowerCase())
                ? '✓ signed'
                : approved.has(o.toLowerCase())
                  ? '✓ approved onchain'
                  : 'not signed'}
            </span>
            <AddressView chainId={props.chainId} address={o} wrap />
          </li>
        ))}
        {safe?.owners &&
          nonOwners.map((s) => (
            <li
              key={s.signer}
              className="flex items-baseline gap-2 text-amber-700 dark:text-amber-400"
            >
              <span className={STATUS}>ignored</span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <AddressView chainId={props.chainId} address={s.signer} wrap />
                <span>signature from non-owner</span>
              </span>
            </li>
          ))}
        {props.rejected?.map((r) => (
          <li key={r.signer} className="text-destructive">
            Rejected signature claimed by {r.signer}: {r.reason}.
          </li>
        ))}
      </ul>
    </section>
  )
}

// The three hashes, always visible on review screens (SPEC §3.4 item 6, §5.1).
import { CopyButton } from '@/components/address'
import type { SafeTxHashes } from '@/core/safe-tx'

export function HashesPanel({ hashes }: { hashes: SafeTxHashes }) {
  const rows = [
    ['Domain hash', hashes.domain],
    ['Message hash', hashes.message],
    ['safeTxHash', hashes.safeTx],
  ] as const
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" data-testid="hashes">
      <h2 className="font-medium">Hashes</h2>
      <dl className="flex flex-col gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="flex items-start gap-1">
              <span className="font-mono text-xs break-all" data-hash={label}>
                {value}
              </span>
              <CopyButton value={value} label={`Copy ${label}`} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Compare these with your wallet or hardware device screen, and with an independent tool such
        as safe-tx-hashes-util, before you sign.
      </p>
    </section>
  )
}

import { Import, Plus, ShieldCheck } from 'lucide-react'
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEnsName } from '@/queries/ens'
import { useLabelOf, useSafeList } from '@/queries/safes'
import { useChainName } from '@/queries/settings'
import type { SafeRecord } from '@/schemas/safes'

export function Home() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Safes</h1>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" asChild>
            <Link href="/verify">
              <ShieldCheck /> Verify
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/import">
              <Import /> Import a transaction
            </Link>
          </Button>
          <Button asChild>
            <Link href="/add">
              <Plus /> Add a Safe
            </Link>
          </Button>
        </div>
      </div>
      <SafeList store="safes" empty="No Safes yet." />
      <h2 className="text-lg font-semibold">Recent</h2>
      <SafeList store="recent" empty="Safes you open from shared links appear here." />
    </div>
  )
}

function SafeList({ store, empty }: { store: 'safes' | 'recent'; empty: string }) {
  const list = useSafeList(store)
  const chainName = useChainName()
  const invalid = list.data?.invalid.length ?? 0
  return (
    <div className="flex flex-col gap-2">
      {list.data?.safes.length === 0 && <p className="text-muted-foreground">{empty}</p>}
      <ul className="flex flex-col divide-y rounded-lg border empty:hidden" data-testid="safe-list">
        {list.data?.safes.map((s) => (
          <SafeRow key={`${s.chainId}:${s.address}`} safe={s} chainName={chainName(s.chainId)} />
        ))}
      </ul>
      {invalid > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {invalid} stored record(s) failed validation and were not used.
        </p>
      )}
    </div>
  )
}

/** One Safe: your label, its ENS name, and always the address next to them (SPEC §8.5). */
function SafeRow({ safe: s, chainName }: { safe: SafeRecord; chainName: string }) {
  const labelOf = useLabelOf()
  const ens = useEnsName(s.chainId, s.address)
  const label = labelOf(s.chainId, s.address)
  return (
    <li>
      <Link
        href={`/safe/${s.chainId}/${s.address}`}
        className="flex items-center justify-between gap-4 p-3 hover:bg-muted"
      >
        {/* A fixed 24px line, so a name that resolves after the first paint doesn't change the
            row's height. Next to a name the address steps down a size, but it's always shown
            (SPEC §8.5: a name is never shown alone). */}
        <span className="flex h-6 min-w-0 items-baseline gap-2 text-sm leading-6">
          {label && <span className="truncate font-medium">{label}</span>}
          {ens.data && (
            <span className="truncate text-sky-800 dark:text-sky-300" data-testid="ens-name">
              {ens.data}
            </span>
          )}
          <span
            className={cn(
              'shrink-0 font-mono',
              (label || ens.data) && 'text-xs text-muted-foreground',
            )}
          >
            {shortAddress(s.address)}
          </span>
        </span>
        <span className="shrink-0 text-sm text-muted-foreground">
          {chainName}
          {s.lastSeen && ` · ${s.lastSeen.threshold} of ${s.lastSeen.ownerCount}`}
        </span>
      </Link>
    </li>
  )
}

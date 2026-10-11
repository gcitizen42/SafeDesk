// #/safe/:chainId/:address (SPEC §9.4): identity and authenticity, the numbers that matter,
// balances and owners, with the verification details folded away.
import {
  ChevronRight,
  Ellipsis,
  History,
  ListChecks,
  Plus,
  RefreshCw,
  Repeat,
  Star,
  Trash2,
} from 'lucide-react'
import type { Address } from 'viem'
import { Link } from 'wouter'
import { AddressView } from '@/components/address'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BalancesSection, useValuedBalances } from '@/features/balances/balances-section'
import { formatAmount } from '@/features/balances/format'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useEnsName } from '@/queries/ens'
import { useLabelOf, useRemoveSafe, useSafe, useSafeList, useSaveSafe } from '@/queries/safes'
import { useChain } from '@/queries/settings'
import { useSwapContracts } from '@/queries/swap'
import { AuthenticityBadge, AuthenticityDetails } from './authenticity-badge'
import type { SafeSnapshot } from './load-safe'
import { hasSafe, safeRecord } from './store'
import { useSafeParams } from './use-safe-params'

export function SafeOverview() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  return <Overview chainId={target.chainId} address={target.address} />
}

function Overview({ chainId, address }: { chainId: number; address: Address }) {
  const safe = useSafe(chainId, address)
  // Started now rather than once the Safe has loaded, so their reads share its batches (the
  // balances section below uses the same cached queries)
  const valued = useValuedBalances(chainId, address)
  const labelOf = useLabelOf()
  const ens = useEnsName(chainId, address)
  const mySafes = useSafeList('safes')
  const save = useSaveSafe('safes')
  const remove = useRemoveSafe('safes')
  const saved = mySafes.data && hasSafe(mySafes.data.safes, chainId, address)
  const verified = safe.data?.authenticity.status === 'verified'
  const swap = useSwapContracts(chainId)
  const chain = useChain(chainId)
  const label = labelOf(chainId, address)
  const base = `/safe/${chainId}/${address}`
  const record = safe.data ? safeRecord(safe.data) : undefined

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      {/* Who this is: its name (yours, else ENS) above the address, never alone (SPEC §8.5) */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1
            className={cn(
              'truncate text-2xl font-semibold',
              !label && ens.data && 'text-sky-800 dark:text-sky-300',
            )}
            data-testid="safe-title"
          >
            {label ?? ens.data ?? 'Safe'}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {label && ens.data && (
              <span className="text-sm text-sky-800 dark:text-sky-300" data-testid="ens-name">
                {ens.data}
              </span>
            )}
            <AddressView chainId={chainId} address={address} addressOnly />
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {chain?.name ?? `Chain ${chainId}`}
            </span>
            {safe.data && <AuthenticityBadge authenticity={safe.data.authenticity} />}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void safe.refetch()} disabled={safe.isFetching}>
              <RefreshCw /> Refresh
            </DropdownMenuItem>
            {saved && (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => remove.mutate({ chainId, address })}
              >
                <Trash2 /> Remove from My Safes
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {safe.isPending && <p className="text-muted-foreground">Reading the Safe…</p>}
      {safe.error && (
        <div className="flex flex-col gap-2">
          <p className="text-destructive">{describeError(safe.error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void safe.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {safe.data && (
        <>
          <div className="flex flex-wrap gap-2">
            {verified ? (
              <Button asChild>
                <Link href={`${base}/new`}>
                  <Plus /> New transaction
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <Plus /> New transaction
              </Button>
            )}
            {verified && swap.data && (
              <Button variant="outline" asChild>
                <Link href={`${base}/swap`}>
                  <Repeat /> Swap
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`${base}/queue`}>
                <ListChecks /> Queue
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`${base}/history`}>
                <History /> History
              </Link>
            </Button>
            {!saved && record && (
              <Button
                variant="ghost"
                onClick={() => save.mutate(record)}
                disabled={save.isPending || mySafes.isPending}
              >
                <Star /> Add to My Safes
              </Button>
            )}
          </div>

          <Summary safe={safe.data} valued={valued} />
          <BalancesSection chainId={chainId} safe={address} />
          <Owners safe={safe.data} verified={verified} />
          <Verification safe={safe.data} />
        </>
      )}
    </div>
  )
}

/** The three numbers people check most: what it holds, who must sign, what's next. */
function Summary({
  safe,
  valued,
}: {
  safe: SafeSnapshot
  valued: ReturnType<typeof useValuedBalances>
}) {
  const { native } = valued
  const total = valued.total !== undefined ? valued.value(valued.total) : undefined
  const tiles = [
    total
      ? { label: 'Total value', value: total, id: 'total' }
      : {
          label: 'Balance',
          value: `${formatAmount(safe.balance, native.decimals)} ${native.symbol}`,
          id: 'native-balance',
        },
    {
      label: 'Signatures needed',
      value:
        safe.threshold !== undefined && safe.owners
          ? `${safe.threshold} of ${safe.owners.length}`
          : 'unknown',
      id: 'threshold',
    },
    { label: 'Next nonce', value: safe.nonce?.toString() ?? 'unknown', id: 'nonce' },
  ]
  return (
    <div className="grid grid-cols-3 divide-x rounded-lg border">
      {tiles.map((t) => (
        <div key={t.id} className="flex min-w-0 flex-col gap-0.5 p-3 sm:p-4">
          <span className="text-xs text-muted-foreground">{t.label}</span>
          <span className="text-base font-semibold break-words sm:text-xl" data-testid={t.id}>
            {/* Values are approximate (spot prices): the ≈ stays, but quietly */}
            {t.value.startsWith('≈ ') ? (
              <>
                <span className="font-normal text-muted-foreground">≈ </span>
                {t.value.slice(2)}
              </>
            ) : (
              t.value
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

function Owners({ safe, verified }: { safe: SafeSnapshot; verified: boolean }) {
  if (!safe.owners) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">
        Owners
        {!verified && (
          <span className="font-normal text-muted-foreground">
            {' '}
            (unverified contract: may not mean anything)
          </span>
        )}
      </h2>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2" data-testid="owners">
        {safe.owners.map((o) => (
          <li key={o} className="min-w-0">
            <AddressView chainId={safe.chainId} address={o} compact />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** How the Safe was verified, folded away unless something is wrong (SPEC §4.2). */
function Verification({ safe }: { safe: SafeSnapshot }) {
  const verified = safe.authenticity.status === 'verified'
  return (
    <Collapsible defaultOpen={!verified} className="border-t pt-3">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
        {verified ? 'How this Safe was verified' : "Why this contract isn't verified"} · read at
        block {safe.block.toString()}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-3 pl-5.5">
        <AuthenticityDetails authenticity={safe.authenticity} />
        {safe.reportedVersion !== undefined && (
          <p className="text-sm text-muted-foreground">
            VERSION() returns {safe.reportedVersion} (for information only: the code hash decides
            the version).
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

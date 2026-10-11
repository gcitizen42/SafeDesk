// Onchain history on the History view (SPEC §11): turned on per Safe, scanned by a worker, and
// shown with its completeness, never as complete when it isn't. Grouped by day; each row opens
// in place (feed-row.tsx).
import { Check, PowerOff, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Address } from 'viem'
import { Callout } from '@/components/callout'
import { TooltipButton } from '@/components/tooltip-button'
import { Button } from '@/components/ui/button'
import { isExecution } from '@/core/history'
import { buildFeed, type FeedItem, feedItemKey, groupByDay } from '@/core/history-feed'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { plural } from '@/lib/format'
import { useResetHistory, useStoredHistory, useTurnOffHistory } from '@/queries/history'
import { useChain, useLoadedSettings } from '@/queries/settings'
import type { HistoryCheckpoint } from '@/schemas/history'
import { FeedRow } from './feed-row'
import { historyTarget, startHistory } from './manager'
import { historyFloor } from './store'

/** Rows shown at first, and added by each "Show earlier". */
const PAGE = 30

export function OnchainHistory({
  chainId,
  safe,
  snapshot,
}: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
}) {
  const settings = useLoadedSettings()
  const { checkpoint, events, state } = useStoredHistory(chainId, safe)
  const resetHistory = useResetHistory(chainId, safe)
  const turnOffHistory = useTurnOffHistory()
  const chain = useChain(chainId)
  const cp = checkpoint.data ?? undefined
  const a = snapshot?.authenticity
  const [shown, setShown] = useState(PAGE)
  const tip = cp?.tip
  const feed = useMemo(
    () => buildFeed([...(events.data ?? []), ...(tip ?? [])]),
    [events.data, tip],
  )
  // Each multisig execution, with how many came after it (for the L1 nonce guess)
  const later = useMemo(() => {
    const m = new Map<string, number>()
    let n = 0
    for (const item of feed)
      if (item.kind === 'execution' && isExecution(item.event.name)) m.set(feedItemKey(item), n++)
    return m
  }, [feed])

  const start = (c: HistoryCheckpoint) => {
    const target = historyTarget(settings, c)
    if (target) startHistory(target)
  }
  // SPEC §11: opening the History view brings a finished history up to date
  const updated = useRef(false)
  useEffect(() => {
    if (updated.current || !cp?.enabled || state?.running) return
    updated.current = true
    start(cp)
  })

  const reset = () => {
    if (!snapshot || a?.status !== 'verified') return
    resetHistory.mutate({ version: a.version, floor: historyFloor(chainId, snapshot.singleton) })
  }
  const turnOff = () => turnOffHistory.mutate({ chainId, safe })
  const actionError = resetHistory.error ?? turnOffHistory.error

  if (checkpoint.isPending) return null
  if (chain?.rpc._tag !== 'url') {
    return (
      <p className="text-sm text-muted-foreground">
        Onchain history needs an RPC URL for this chain; it can't read logs through your wallet.
      </p>
    )
  }
  const rpcHost = new URL(chain.rpc.url).host
  if (!cp?.enabled) {
    return (
      <section
        className="flex flex-col gap-2 rounded-lg border p-4 text-sm"
        data-testid="history-off"
      >
        <h2 className="font-medium">Onchain history</h2>
        <p className="text-muted-foreground">
          Scan this Safe's events back to its creation over your RPC (
          <span className="font-mono text-xs">{rpcHost}</span>). It runs in the background while
          Plain Safe is open, resumes where it stopped, and is stored only in this browser.
        </p>
        <Button className="self-start" disabled={a?.status !== 'verified'} onClick={reset}>
          Turn on onchain history
        </Button>
        {actionError && <p className="text-destructive">{describeError(actionError)}</p>}
      </section>
    )
  }

  const progress = state?.progress
  const status = state?.running ? 'scanning' : (cp.status ?? 'scanning')
  const nonce = cp.onchainNonce !== undefined ? BigInt(cp.onchainNonce) : snapshot?.nonce
  // The worker's count is current as soon as a chunk commits; the list catches up a moment later
  const executions = progress?.executions ?? later.size
  const of = nonce !== undefined ? ` of ${nonce}` : ''
  const groups = groupByDay(feed.slice(0, shown), (i) => dayKey(i.event.timestamp))

  return (
    <section className="flex flex-col gap-4" data-testid="onchain-history" data-status={status}>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <h2 className="mr-auto font-medium">Onchain history</h2>
          <TooltipButton
            variant="ghost"
            size="sm"
            disabled={state?.running}
            onClick={() => start(cp)}
            tip="Scan the blocks since the last scan for new transactions. This also runs whenever you open this page."
          >
            <RefreshCw /> Refresh
          </TooltipButton>
          <TooltipButton
            variant="ghost"
            size="sm"
            onClick={reset}
            tip="Delete this Safe's stored history and scan again from its creation. Use it if the history looks wrong, for example after changing RPC."
          >
            <RotateCcw /> Rebuild
          </TooltipButton>
          <TooltipButton
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={turnOff}
            tip="Stop scanning and delete this Safe's stored history from this browser. Nothing onchain changes."
          >
            <PowerOff /> Turn off
          </TooltipButton>
        </div>
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="history-progress"
        >
          {state?.elsewhere ? (
            'Another Plain Safe tab is scanning this Safe.'
          ) : status === 'scanning' ? (
            `Scanning back… block ${progress?.scannedDownTo ?? cp.scannedDownTo ?? '…'} · ${executions}${of} transactions found.`
          ) : status === 'complete' ? (
            <>
              <Check className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <span>
                Complete: every one of this Safe's {executions} executions is here, read from{' '}
                {rpcHost}.
              </span>
            </>
          ) : (
            `${executions}${of} transactions found.`
          )}
        </p>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {actionError && <p className="text-sm text-destructive">{describeError(actionError)}</p>}
      {status === 'incomplete' && (
        <Callout severity="yellow" title="History incomplete">
          Your RPC doesn't keep logs back to this Safe's creation. Switch this chain's RPC to one
          with full log history. {cp.reason}
        </Callout>
      )}
      {status === 'unavailable' && (
        <Callout severity="yellow" title="History unavailable">
          {cp.reason ?? "Your RPC doesn't serve historical logs."}
        </Callout>
      )}
      <div className="flex flex-col gap-6" data-testid="history-events">
        {feed.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
        {groups.map((g) => (
          <section
            key={`${g.day}:${feedItemKey(g.items[0] as FeedItem)}`}
            className="flex flex-col gap-2"
            data-testid="history-day"
          >
            <h3 className="flex justify-between gap-4 text-sm font-semibold text-muted-foreground">
              <span>{dayLabel(g.day)}</span>
              <span className="font-normal">{countLabel(g.items)}</span>
            </h3>
            <ol className="divide-y overflow-hidden rounded-xl border">
              {g.items.map((item) => (
                <FeedRow
                  key={feedItemKey(item)}
                  chainId={chainId}
                  safe={safe}
                  snapshot={snapshot}
                  item={item}
                  nonce={nonce}
                  later={later.get(feedItemKey(item)) ?? 0}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
      {feed.length > shown && (
        <Button variant="outline" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
          Show earlier
        </Button>
      )}
    </section>
  )
}

// ---------- dates ----------

/** The local calendar day of a block timestamp (seconds), as YYYY-MM-DD. */
function dayKey(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined
  const d = new Date(Number(timestamp) * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(day: string | undefined): string {
  if (!day) return 'Date not read yet'
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(y, m - 1, d))
}

function countLabel(items: readonly FeedItem[]): string {
  const executions = items.filter((i) => i.kind === 'execution').length
  const received = items.filter((i) => i.kind === 'event' && i.event.name === 'SafeReceived').length
  const other = items.length - executions - received
  return [
    executions ? plural(executions, 'transaction') : '',
    received ? plural(received, 'transfer in', 'transfers in') : '',
    other ? plural(other, 'other event') : '',
  ]
    .filter(Boolean)
    .join(', ')
}

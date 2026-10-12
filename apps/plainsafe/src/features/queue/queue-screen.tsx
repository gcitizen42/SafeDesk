// #/safe/:chainId/:address/queue and /history (SPEC §3.9): packages, grouped by nonce.
import { ExternalLink, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Address, Hex } from 'viem'
import { Link, useLocation } from 'wouter'
import { explorerUrl } from '@/chains'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { classifyQueue, isHistory, QUEUE_STATE_TEXT, type QueueState } from '@/core/queue'
import type { SafeTx } from '@/core/safe-tx'
import { OnchainHistory } from '@/features/history/onchain-history'
import {
  mergePublishedPackages,
  publishedQueueComplete,
  publishedSafeUrl,
  publishedSnapshot,
} from '@/features/queue/published'
import { useTxSummary } from '@/features/review/tx-summary'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useSafeParams } from '@/features/safes/use-safe-params'
import type { QueueSimOutcome } from '@/features/simulation/program'
import { describeError } from '@/lib/errors'
import { list } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDeletePackage, usePackages, useSavePackage } from '@/queries/packages'
import { usePublishedQueue } from '@/queries/published'
import { useSafe } from '@/queries/safes'
import { useChain } from '@/queries/settings'
import { useQueueSimulation } from '@/queries/simulation'

const TONE: Record<QueueState, string> = {
  'needs-signatures': 'bg-muted',
  ready: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  future: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  conflict: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  executed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  'nonce-used': 'bg-muted text-muted-foreground',
}

export function QueueScreen({ history = false }: { history?: boolean }) {
  const target = useSafeParams()
  if (!target) return <NotFound />
  return (
    <Queue
      key={`${target.chainId}:${target.address}:${history}`}
      chainId={target.chainId}
      safe={target.address}
      history={history}
    />
  )
}

/** Which of the facts the queue is sorted by couldn't be read. */
const unreadFacts = (s: SafeSnapshot) =>
  [
    s.owners ? undefined : 'owners',
    s.threshold === undefined ? 'threshold' : undefined,
    s.nonce === undefined ? 'nonce' : undefined,
  ].filter((x) => x !== undefined)

function Queue({ chainId, safe, history }: { chainId: number; safe: Address; history: boolean }) {
  const chain = useChain(chainId)
  const snapshot = useSafe(chainId, safe, { fresh: true })
  const packages = usePackages(chainId, safe)
  const remove = useDeletePackage(chainId, safe)
  const save = useSavePackage()
  const published = usePublishedQueue(chainId, safe, snapshot.data, !history && !snapshot.isError)
  const [, navigate] = useLocation()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const base = `/safe/${chainId}/${safe}`
  const error = snapshot.error ?? packages.error ?? remove.error
  // The queue is sorted by the Safe's nonce, owners and threshold: without them it can't be
  const unread = snapshot.data && unreadFacts(snapshot.data)
  const rows = useMemo(
    () =>
      mergePublishedPackages(
        packages.data?.packages ?? [],
        history ? [] : (published.data?.transactions ?? []),
      ),
    [packages.data, published.data, history],
  )
  const publishedKnown =
    !snapshot.isError &&
    !published.error &&
    !published.isFetching &&
    !refreshing &&
    !refreshFailed &&
    publishedQueueComplete(published.data)
  const safeQueueUrl = publishedSafeUrl(chainId, safe)

  const refresh = async () => {
    setRefreshing(true)
    setRefreshFailed(false)
    try {
      const fresh = await snapshot.refetch()
      const local = await packages.refetch()
      if (fresh.error || local.error) setRefreshFailed(true)
      if (!fresh.error && fresh.data && publishedSnapshot(chainId, safe, fresh.data))
        await published.refresh(fresh.data)
    } catch {
      setRefreshFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  const items =
    snapshot.data?.nonce !== undefined &&
    snapshot.data.threshold !== undefined &&
    snapshot.data.owners &&
    packages.data
      ? classifyQueue(
          rows.map((p) => ({
            safeTxHash: p.verified.hashes.safeTx,
            nonce: p.verified.tx.nonce,
            signers: p.verified.signatures.map((s) => s.signer),
            execution: p.execution,
            p,
          })),
          {
            nonce: snapshot.data.nonce,
            threshold: snapshot.data.threshold,
            owners: snapshot.data.owners,
          },
        ).filter((q) => isHistory(q.state) === history)
      : undefined
  const shown = history ? items?.slice().reverse() : items
  // P1: the queue's consecutive nonces, simulated together
  const queueSim = useQueueSimulation(
    chainId,
    snapshot.data,
    history
      ? undefined
      : items?.map(({ item: { p } }) => ({
          tx: p.verified.tx,
          safeTxHash: p.verified.hashes.safeTx,
        })),
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">{history ? 'History' : 'Queue'}</h1>
        {!history && (
          <Button
            variant="outline"
            size="sm"
            title="Refresh queue"
            disabled={
              refreshing || snapshot.isFetching || packages.isFetching || published.isFetching
            }
            onClick={refresh}
          >
            <RefreshCw className={cn(refreshing && 'animate-spin')} /> Refresh
          </Button>
        )}
        <Link
          href={`${base}/${history ? 'queue' : 'history'}`}
          className="text-sm underline underline-offset-4"
        >
          {history ? 'Queue' : 'History'}
        </Link>
        <Link href={base} className="text-sm underline underline-offset-4">
          Safe
        </Link>
      </div>
      {!history && (
        <section
          className="flex min-w-0 flex-col gap-2 border-b pb-4 text-sm break-words"
          aria-label="Published queue status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" data-testid="published-queue-status">
              {snapshot.isError
                ? 'Published queue unknown: Safe state could not be checked.'
                : refreshFailed || published.error
                  ? 'Published queue unavailable. Published transactions are unknown.'
                  : !publishedSnapshot(chainId, safe, snapshot.data)
                    ? 'Published queue unknown: a code-verified Safe and its nonce are required.'
                    : refreshing || published.isFetching
                      ? 'Checking published queue...'
                      : published.data?.status === 'unsupported'
                        ? 'Published queue is not supported on this chain. Published transactions are unknown.'
                        : published.data?.status === 'partial'
                          ? 'Published queue is partial. Additional transactions may be missing.'
                          : publishedKnown
                            ? 'Published queue checked.'
                            : 'Published queue unavailable. Published transactions are unknown.'}
            </p>
            {safeQueueUrl && (
              <a
                href={safeQueueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 underline underline-offset-4"
              >
                Safe queue <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {!!snapshot.dataUpdatedAt && (
              <span>
                Safe checked{' '}
                <time dateTime={new Date(snapshot.dataUpdatedAt).toISOString()}>
                  {new Date(snapshot.dataUpdatedAt).toLocaleString()}
                </time>
              </span>
            )}
            {published.data?.checkedAt && (
              <span>
                Published checked{' '}
                <time dateTime={published.data.checkedAt}>
                  {new Date(published.data.checkedAt).toLocaleString()}
                </time>
              </span>
            )}
          </div>
          {published.data?.warning && (
            <p className="text-muted-foreground">{published.data.warning}</p>
          )}
          {published.data && (published.data.rejected > 0 || published.data.invalid.length > 0) && (
            <p className="text-amber-700 dark:text-amber-400">
              {published.data.rejected + published.data.invalid.length} published row(s) were
              rejected and were not used.
            </p>
          )}
        </section>
      )}
      {history && <OnchainHistory chainId={chainId} safe={safe} snapshot={snapshot.data} />}
      {history && (
        <h2 className="font-medium" data-testid="local-history-title">
          Local history
          <span className="block text-sm font-normal text-muted-foreground">
            Transactions this browser saw executed, or whose nonce was used by something else.
          </span>
        </h2>
      )}
      {error ? (
        <p className="text-destructive">{describeError(error)}</p>
      ) : unread?.length ? (
        <p className="text-destructive" data-testid="queue-unreadable">
          Couldn't read this Safe's {list(unread)} at block {snapshot.data?.block.toString()}, so
          its transactions can't be sorted into queue and history. Check that this address is a Safe
          and that your {chain?.name ?? 'chain'} RPC answers.
        </p>
      ) : (
        !shown && <p className="text-muted-foreground">Loading…</p>
      )}
      {!history && queueSim.data && queueSim.data.size > 0 && snapshot.data && (
        <p className="text-sm text-muted-foreground" data-testid="queue-simulation">
          Simulated in nonce order at block {snapshot.data.block.toString()}, as if each were
          executed in turn.
        </p>
      )}
      {!history && queueSim.error && (
        <p className="text-sm text-muted-foreground">
          The queue wasn't simulated: {describeError(queueSim.error)}
        </p>
      )}
      {shown?.length === 0 && (
        <p className="text-muted-foreground">
          {history
            ? 'Nothing here yet.'
            : publishedKnown && !error
              ? 'No pending transactions. Build one, or import a shared link.'
              : 'No verified pending rows to show. The published queue is not fully known.'}
        </p>
      )}
      {!history && save.error && (
        <p className="text-destructive">Could not save this transaction locally. Try again.</p>
      )}
      <ul className="flex flex-col gap-2" data-testid={history ? 'history' : 'queue'}>
        {shown?.map(({ item, state, validSignatures }) => {
          const { p } = item
          const tx = p.verified.tx
          const execLink =
            p.execution && chain ? explorerUrl(chain, 'tx', p.execution.txHash) : undefined
          const summary = (
            <>
              <RowSummary
                chainId={chainId}
                safe={safe}
                snapshot={snapshot.data}
                tx={tx}
                safeTxHash={item.safeTxHash}
              />
              <span className="font-mono text-xs text-muted-foreground">
                {item.safeTxHash.slice(0, 18)}…
              </span>
            </>
          )
          return (
            <li
              key={item.safeTxHash}
              className={cn(
                'flex gap-3 border p-3',
                history
                  ? 'items-center rounded-lg'
                  : 'flex-wrap items-start rounded-[8px] sm:items-center',
              )}
              data-state={state}
              data-source={p.local ? (p.published ? 'local-published' : 'local') : 'published'}
            >
              <span
                className={cn(
                  'w-12 shrink-0 font-mono text-sm text-muted-foreground',
                  !history && 'break-all',
                )}
              >
                #{tx.nonce.toString()}
              </span>
              {p.local ? (
                <Link
                  href={`${base}/tx/${item.safeTxHash}`}
                  className="flex min-w-0 flex-1 flex-col hover:underline"
                >
                  {summary}
                </Link>
              ) : (
                <div className="flex min-w-0 flex-1 flex-col">{summary}</div>
              )}
              <div
                className={cn(
                  'flex flex-col items-end gap-1',
                  !history && 'ml-auto max-w-full basis-full sm:basis-auto',
                )}
              >
                {!history && (
                  <span className="text-xs text-muted-foreground">
                    {p.local ? (p.published ? 'Published + Local' : 'Local') : 'Published'}
                  </span>
                )}
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONE[state])}>
                  {!p.local && state === 'ready'
                    ? 'Signature threshold met'
                    : QUEUE_STATE_TEXT[state]}
                </span>
                <SimBadge outcome={queueSim.data?.get(item.safeTxHash)} />
                {!history && snapshot.data?.threshold !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {validSignatures} of {snapshot.data.threshold.toString()}{' '}
                    {p.published ? 'verified owner signatures' : 'signatures'}
                  </span>
                )}
                {!history && p.published && (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {p.published.reportedConfirmations} service-reported confirmations
                    </span>
                    {p.published.rejectedConfirmations.length > 0 && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        {p.published.rejectedConfirmations.length} service confirmation(s) excluded
                      </span>
                    )}
                    {!p.local && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={save.isPending || refreshing || snapshot.isError}
                        onClick={() =>
                          save.mutate(p.verified, {
                            onSuccess: () => navigate(`${base}/tx/${item.safeTxHash}`),
                          })
                        }
                      >
                        <Eye /> Review locally
                      </Button>
                    )}
                  </>
                )}
                {execLink && (
                  <a
                    href={execLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs underline"
                  >
                    transaction <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              {p.local && (history || state === 'conflict') && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete from this browser"
                  title="Delete from this browser"
                  onClick={() => remove.mutate(item.safeTxHash)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {items?.some((i) => i.state === 'conflict') && (
        <p className="text-sm text-orange-800 dark:text-orange-300">
          A conflict means two different transactions use the same nonce: only one can execute.{' '}
          {history
            ? "Delete the one you don't want."
            : 'Published transactions remain in the service even if a local copy is deleted.'}
        </p>
      )}
      {packages.data && packages.data.invalid.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {packages.data.invalid.length} stored package(s) failed verification and were not used.
        </p>
      )}
    </div>
  )
}

/** The same summary as the review screen (SPEC §7.1): clear signing first, then our decoding. */
function RowSummary(props: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
  tx: SafeTx
  safeTxHash: Hex
}) {
  const summary = useTxSummary(
    props.chainId,
    props.safe,
    props.snapshot,
    props.tx,
    props.safeTxHash,
  )
  return (
    <span
      className="truncate"
      title={summary.clearSigning ? 'Clear signing, not reviewed' : undefined}
    >
      {summary.text}
    </span>
  )
}

function SimBadge({ outcome }: { outcome: QueueSimOutcome | undefined }) {
  if (!outcome) return null
  const [text, tone, title] =
    outcome.status === 'ok'
      ? ['✓ simulates', 'text-emerald-700 dark:text-emerald-400', undefined]
      : outcome.status === 'fails'
        ? ['✗ would fail', 'text-destructive', outcome.reason]
        : [
            'after a failing nonce',
            'text-muted-foreground',
            `Nonce ${outcome.nonce} would fail first, so this one wasn't simulated.`,
          ]
  return (
    <span
      className={cn('text-xs', tone)}
      title={title}
      data-testid="row-sim"
      data-sim={outcome.status}
    >
      {text}
    </span>
  )
}

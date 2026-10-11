// The swap on the review screen (SPEC §3.13, "handling the multisig delay"): what was signed,
// a fresh quote for exactly that route against the signed minimum, and the deadline.
import { RefreshCw } from 'lucide-react'
import type { Address } from 'viem'
import { TooltipButton } from '@/components/tooltip-button'
import type { SafeTx } from '@/core/safe-tx'
import { type SwapSummary, swapInTx, type UniswapContracts } from '@/core/uniswap'
import { formatAmount } from '@/features/balances/format'
import { describeError } from '@/lib/errors'
import { useRequote, useSwapContracts } from '@/queries/swap'
import { routeText, useCoin, useSymbols } from './coins'

const RED_BOX =
  'rounded-md border border-red-300 bg-red-50 p-2 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'

export function SwapPanel(props: { chainId: number; safe: Address; tx: SafeTx }) {
  const contracts = useSwapContracts(props.chainId)
  if (!contracts.data) return null
  const swap = swapInTx(props.tx, props.safe, contracts.data)
  if (!swap) return null
  return <SwapDetails chainId={props.chainId} contracts={contracts.data} swap={swap} />
}

function SwapDetails({
  chainId,
  contracts,
  swap,
}: {
  chainId: number
  contracts: UniswapContracts
  swap: SwapSummary
}) {
  const sell = useCoin(chainId, swap.sell)
  const buy = useCoin(chainId, swap.buy)
  const symbol = useSymbols(chainId)
  const fresh = useRequote(chainId, contracts, swap.route, swap.amountIn)
  const expired = Number(swap.deadline) * 1000 <= Date.now()
  const now = fresh.data?.amountOut
  const below = now !== undefined && now < swap.minOut
  const fmt = (amount: bigint, coin: typeof buy) =>
    coin ? `${formatAmount(amount, coin.decimals)} ${coin.symbol}` : amount.toString()

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4 text-sm" data-testid="swap-panel">
      <h2 className="font-medium">Uniswap swap</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Sells</dt>
        <dd>{fmt(swap.amountIn, sell)}</dd>
        <dt className="text-muted-foreground">Signed minimum</dt>
        <dd>{fmt(swap.minOut, buy)}, to this Safe</dd>
        <dt className="text-muted-foreground">Route</dt>
        <dd className="font-mono text-xs">{routeText(swap.route, symbol)}</dd>
        <dt className="text-muted-foreground">Deadline</dt>
        <dd>{new Date(Number(swap.deadline) * 1000).toLocaleString()}</dd>
      </dl>
      {expired ? (
        <p className={RED_BOX} data-testid="swap-expired">
          This swap expired. Create a new one.
        </p>
      ) : fresh.isPending ? (
        <p className="text-muted-foreground">Getting a fresh quote…</p>
      ) : fresh.error ? (
        <p className="text-destructive">{describeError(fresh.error)}</p>
      ) : now === undefined ? (
        <p className="text-destructive" data-testid="swap-no-quote">
          This route no longer returns a quote, so the swap would fail now.
        </p>
      ) : (
        <p
          className={below ? RED_BOX : 'text-muted-foreground'}
          data-testid="swap-fresh-quote"
          data-below={below}
        >
          Current quote: {fmt(now, buy)} at block {fresh.data?.block.toString()}
          {below
            ? '. That is below the signed minimum, so the swap would revert if executed now.'
            : `, ${formatAmount(now - swap.minOut, buy?.decimals ?? 0)} above the signed minimum.`}{' '}
          <TooltipButton
            variant="outline"
            size="xs"
            className="ml-1 align-middle"
            onClick={() => void fresh.refetch()}
            disabled={fresh.isFetching}
            tip="Get a new quote now. It also refreshes every 30 seconds while this page is open."
          >
            <RefreshCw /> {fresh.isFetching ? 'Refreshing…' : 'Refresh'}
          </TooltipButton>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        When you execute, consider sending the transaction through a private RPC in your wallet (for
        example MEV Blocker's), so the swap can't be front-run.
      </p>
    </section>
  )
}

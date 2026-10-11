// Balances (SPEC §10): tokens from your lists and My tokens, read at one pinned block.
import { useState } from 'react'
import type { Address } from 'viem'
import { Link } from 'wouter'
import { TokenMonogram } from '@/components/token-monogram'
import { valueInWei } from '@/core/prices'
import { duplicateSymbols } from '@/core/tokenlist'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useLoadedSettings, useNativeCurrency } from '@/queries/settings'
import { useBalances, useEthFiat } from '@/queries/tokens'
import { formatAmount, formatValue } from './format'

/**
 * Balances with their values in your currency: shared by the list below and the overview's total,
 * so both read the same cached queries.
 */
export function useValuedBalances(chainId: number, safe: Address) {
  const settings = useLoadedSettings()
  const native = useNativeCurrency(chainId)
  const balances = useBalances(chainId, safe)
  const fiat = useEthFiat()
  const nativeIsEth = native.symbol === 'ETH' && native.decimals === 18
  const currency = settings.currency
  const fiatRate = fiat.data
  // Fiat needs Mainnet's ETH price, and only applies where the native currency is ETH.
  const canValue = (currency === 'ETH' || !!fiatRate) && nativeIsEth
  const b = balances.data
  const priced = !!b?.priced && canValue
  const total =
    b && priced
      ? b.native +
        b.tokens.reduce((sum, t) => sum + (t.rate ? valueInWei(t.balance, t.rate) : 0n), 0n)
      : undefined
  const value = (wei: bigint) => (priced ? formatValue(wei, currency, fiatRate) : undefined)
  return { balances, native, nativeIsEth, currency, fiatRate, priced, total, value }
}

/** The list of balances; the overview shows their total in its summary. */
export function BalancesSection(props: { chainId: number; safe: Address }) {
  const { balances, native, nativeIsEth, currency, fiatRate, priced, value } = useValuedBalances(
    props.chainId,
    props.safe,
  )
  const [showZero, setShowZero] = useState(false)

  if (balances.isPending) return <p className="text-sm text-muted-foreground">Reading balances…</p>
  if (balances.error)
    return <p className="text-sm text-destructive">{describeError(balances.error)}</p>
  const b = balances.data
  const dupes = duplicateSymbols(b.tokens.map((t) => t.token))
  const rows = b.tokens.filter((t) => showZero || t.balance > 0n)

  return (
    <section className="flex flex-col gap-3" data-testid="balances">
      <h2 className="font-medium">Balances</h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        <Row
          symbol={native.symbol}
          detail="Native currency"
          amount={formatAmount(b.native, native.decimals)}
          value={nativeIsEth ? value(b.native) : undefined}
        />
        {rows.map((t) => (
          <Row
            key={t.token.address}
            symbol={t.token.symbol}
            detail={shortAddress(t.token.address)}
            duplicate={dupes.has(t.token.address.toLowerCase())}
            amount={formatAmount(t.balance, t.token.decimals)}
            value={priced ? (t.rate ? value(valueInWei(t.balance, t.rate)) : '—') : undefined}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>As of block {b.block.toString()}.</span>
        {!b.priced && <span>Prices aren't available on this chain.</span>}
        {b.priced && currency !== 'ETH' && !fiatRate && (
          <span>Fiat values need a Mainnet RPC.</span>
        )}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setShowZero((s) => !s)}
        >
          {showZero ? 'Hide zero balances' : 'Show zero balances'}
        </button>
        <Link href="/settings/tokens" className="underline underline-offset-2">
          Token lists
        </Link>
      </div>
    </section>
  )
}

function Row(props: {
  symbol: string
  detail: string
  amount: string
  value?: string | undefined
  duplicate?: boolean
}) {
  return (
    <li className="flex items-center gap-3 p-3">
      <TokenMonogram symbol={props.symbol} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 font-medium">
          {props.symbol}
          {props.duplicate && (
            <span className="rounded bg-amber-100 px-1.5 text-xs font-normal text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              duplicate symbol
            </span>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">{props.detail}</span>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-sm">{props.amount}</span>
        {props.value && <span className="text-xs text-muted-foreground">{props.value}</span>}
      </div>
    </li>
  )
}

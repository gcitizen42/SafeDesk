// The Swap form (SPEC §3.13): sell a held token or ETH for any listed token, quoted onchain
// across Uniswap v3 and v4. Reports the Safe transaction to the builder, which reviews it.
import { useState } from 'react'
import type { Address } from 'viem'
import { AddressField, AmountField, parseAmount } from '@/components/inputs'
import { Select } from '@/components/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ETH,
  minimumOut,
  type SwapIntent,
  type SwapPlan,
  type UniswapContracts,
} from '@/core/uniswap'
import { formatAmount } from '@/features/balances/format'
import {
  FROM_CONTRACT,
  OTHER,
  type PresetProps,
  TokenSource,
  usePickedToken,
  useReport,
} from '@/features/builder/presets'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useBuiltSwap, useSwapContracts, useSwapQuote } from '@/queries/swap'
import { useBalances, useTokenUniverse } from '@/queries/tokens'
import { type Coin, routeText, useSymbols } from './coins'
import type { TwapCheck } from './program'

interface Token extends Coin {
  readonly address: Address
}

const ETH_TOKEN: Token = { address: ETH, symbol: 'ETH', decimals: 18 }

export function SwapPreset({ safe, onResult }: PresetProps) {
  const contracts = useSwapContracts(safe.chainId)
  if (contracts.isPending) return <p className="text-muted-foreground">Checking Uniswap…</p>
  if (contracts.error) return <p className="text-destructive">{describeError(contracts.error)}</p>
  if (!contracts.data)
    return (
      <p className="text-muted-foreground">
        Swap isn't available on this chain: Uniswap's contracts aren't deployed here.
      </p>
    )
  return <SwapForm safe={safe} contracts={contracts.data} onResult={onResult} />
}

function SwapForm({ safe, contracts, onResult }: PresetProps & { contracts: UniswapContracts }) {
  const universe = useTokenUniverse(safe.chainId)
  const balances = useBalances(safe.chainId, safe.address, { fresh: true })
  const symbol = useSymbols(safe.chainId)
  const [sellChoice, setSellChoice] = useState<string>(ETH)
  const [buyChoice, setBuyChoice] = useState<string>('')
  const [buyText, setBuyText] = useState('')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState('1')
  const [hours, setHours] = useState('24')

  // Sell: ETH and every token the Safe holds
  const held = (balances.data?.tokens ?? []).filter((t) => t.balance > 0n)
  const heldSell = held.find((t) => t.token.address.toLowerCase() === sellChoice.toLowerCase())
  const sell: Token | undefined = sellChoice === ETH ? ETH_TOKEN : heldSell?.token
  const sellBalance = sellChoice === ETH ? safe.balance : heldSell?.balance

  // Buy: ETH, any listed token, or a token by address
  const picked = usePickedToken(safe.chainId, buyChoice, buyText)
  const buy: Token | undefined = buyChoice === ETH ? ETH_TOKEN : picked.token

  const amountIn = sell ? parseAmount(amount, sell.decimals) : undefined
  const slippageBps = parseSlippageBps(slippage)
  const deadlineHours = parseDeadlineHours(hours)

  const intent: SwapIntent | undefined =
    sell && buy && amountIn && amountIn > 0n && sell.address !== buy.address
      ? { sell: sell.address, buy: buy.address, amountIn }
      : undefined
  const quote = useSwapQuote(safe.chainId, contracts, intent)
  const best = quote.data?.best

  const plan: SwapPlan | undefined =
    intent && best && slippageBps !== undefined && deadlineHours !== undefined
      ? {
          intent,
          route: best.route,
          minOut: minimumOut(best.amountOut, slippageBps),
          recipient: safe.address,
          // The deadline counts from when the quote was taken
          deadline: BigInt(Math.floor(quote.dataUpdatedAt / 1000) + deadlineHours * 3600),
        }
      : undefined
  const built = useBuiltSwap(safe, contracts, plan)
  const result =
    plan && built.data && sell && buy
      ? {
          call: built.data,
          description: `Swap ${formatAmount(plan.intent.amountIn, sell.decimals)} ${sell.symbol} for at least ${formatAmount(plan.minOut, buy.decimals)} ${buy.symbol} on Uniswap ${plan.route.protocol}`,
        }
      : undefined
  useReport(result, onResult)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sell">Sell</Label>
          <Select id="sell" value={sellChoice} onChange={(e) => setSellChoice(e.target.value)}>
            <option value={ETH}>ETH · {formatAmount(safe.balance, 18)}</option>
            {held.map(({ token, balance }) => (
              <option key={token.address} value={token.address}>
                {token.symbol} · {shortAddress(token.address)} ·{' '}
                {formatAmount(balance, token.decimals)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="buy">Buy</Label>
          <Select id="buy" value={buyChoice} onChange={(e) => setBuyChoice(e.target.value)}>
            <option value="">Choose a token…</option>
            <option value={ETH}>ETH</option>
            {(universe ?? []).map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} · {shortAddress(t.address)} · from {t.source}
              </option>
            ))}
            <option value={OTHER}>Other token (by address)…</option>
          </Select>
        </div>
      </div>
      {buyChoice === OTHER && (
        <AddressField
          label="Token to buy"
          chainId={safe.chainId}
          value={buyText}
          onChange={setBuyText}
        />
      )}
      {picked.meta.error && (
        <p className="text-sm text-destructive">{describeError(picked.meta.error)}</p>
      )}
      {picked.token?.source === FROM_CONTRACT && <TokenSource token={picked.token} />}
      {sell && (
        <AmountField
          label="Amount to sell"
          value={amount}
          onChange={setAmount}
          decimals={sell.decimals}
          symbol={sell.symbol}
          max={sellBalance}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slippage">Slippage (%)</Label>
          <Input
            id="slippage"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            inputMode="decimal"
            className="w-32 font-mono"
          />
          {slippageBps === undefined && (
            <p className="text-sm text-destructive">Enter a percentage between 0.01 and 49.99.</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deadline">Deadline (hours)</Label>
          <Input
            id="deadline"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            inputMode="numeric"
            className="w-32 font-mono"
          />
          {deadlineHours === undefined && (
            <p className="text-sm text-destructive">Enter whole hours, from 1 to 720.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Signatures take time, so the default is a day.
          </p>
        </div>
      </div>
      {sell && buy && sell.address === buy.address && (
        <p className="text-sm text-destructive">Choose two different tokens.</p>
      )}
      {intent && <QuotePanel quote={quote} plan={plan} built={built} buy={buy} symbol={symbol} />}
    </div>
  )
}

/** Slippage in basis points, from a percentage with up to two decimals, below 50%. */
function parseSlippageBps(text: string): number | undefined {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return undefined
  const bps = Math.round(Number(text) * 100)
  return bps > 0 && bps < 5000 ? bps : undefined
}

/** Whole hours, from 1 to 30 days. */
function parseDeadlineHours(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined
  const hours = Number(text)
  return hours >= 1 && hours <= 24 * 30 ? hours : undefined
}

function QuotePanel(props: {
  quote: ReturnType<typeof useSwapQuote>
  plan: SwapPlan | undefined
  built: ReturnType<typeof useBuiltSwap>
  buy: Token | undefined
  symbol: (a: Address) => string
}) {
  const { quote, plan, built, buy, symbol } = props
  if (quote.isPending) return <p className="text-sm text-muted-foreground">Getting quotes…</p>
  if (quote.error) return <p className="text-sm text-destructive">{describeError(quote.error)}</p>
  const q = quote.data
  if (!q || !buy)
    return (
      <p className="rounded-lg border p-3 text-sm" data-testid="no-route">
        No Uniswap route found for this pair and amount.
      </p>
    )
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" data-testid="swap-quote">
      <p className="text-base font-medium">
        ≈ {formatAmount(q.best.amountOut, buy.decimals)} {buy.symbol}
      </p>
      <p>
        Route: <span className="font-mono">{routeText(q.best.route, symbol)}</span>
      </p>
      {plan && (
        <p>
          Minimum received: {formatAmount(plan.minOut, buy.decimals)} {buy.symbol}, until{' '}
          {new Date(Number(plan.deadline) * 1000).toLocaleString()}
        </p>
      )}
      <p className="text-muted-foreground">
        Best of {q.quoted} quoted routes ({q.asked} tried) at block {q.block.toString()}, from
        Uniswap's quoter contracts through your RPC.
      </p>
      <TwapLine twap={q.twap} />
      {built.isLoading && <p className="text-muted-foreground">Preparing the transaction…</p>}
      {built.error && <p className="text-destructive">{describeError(built.error)}</p>}
      {built.data === null && (
        <p className="text-destructive">
          There's no verified MultiSendCallOnly on this chain, so this swap can't be batched.
        </p>
      )}
    </div>
  )
}

function TwapLine({ twap }: { twap: TwapCheck }) {
  if (twap.kind === 'unavailable')
    return <p className="text-muted-foreground">No TWAP check for this route.</p>
  const pct = `${(Math.abs(twap.shortfall) * 100).toFixed(2)}%`
  if (twap.kind === 'worse')
    return (
      <p
        className="rounded-md border border-orange-300 bg-orange-50 p-2 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200"
        data-testid="twap-warning"
      >
        This quote is {pct} worse than Uniswap's 30-minute average price implies. The pool may be
        thin or its price may have been moved. Consider a smaller amount or waiting.
      </p>
    )
  return (
    <p className="text-muted-foreground" data-testid="twap-ok">
      Within 2% of Uniswap's 30-minute average price ({pct}{' '}
      {twap.shortfall > 0 ? 'worse' : 'better'}).
    </p>
  )
}

import { formatUnits } from 'viem'
import { fiatPerEth } from '@/core/prices'

/** "≈ $1,234.56" or "≈ 0.1234 ETH": display only (SPEC §10.1). */
export function formatValue(
  valueWei: bigint,
  currency: string,
  fiat?: { rate: bigint; decimals: number },
): string | undefined {
  if (currency === 'ETH')
    return `≈ ${Number(formatUnits(valueWei, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`
  if (!fiat) return undefined
  const perEth = fiatPerEth(fiat.rate, fiat.decimals)
  if (perEth === undefined) return undefined
  const amount = Number(formatUnits(valueWei, 18)) * perEth
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 })}`
}

export function formatAmount(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals))
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 })
}

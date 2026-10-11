// Symbols and decimals for swap amounts: ETH, then your token lists, then the chain's Uniswap
// WETH and USDC from the bundled table, then (unless offline) the token contract over RPC.
import type { Address } from 'viem'
import { isEth, type Route, UNISWAP } from '@/core/uniswap'
import type { TokenInfo } from '@/features/tokens/store'
import { shortAddress } from '@/lib/format'
import { useTokenMeta } from '@/queries/contracts'
import { useTokenUniverse } from '@/queries/tokens'

export interface Coin {
  readonly symbol: string
  readonly decimals: number
}

/** Everything but the RPC read: ETH, your lists, then the bundled WETH and USDC. */
function knownCoin(
  chainId: number,
  universe: readonly TokenInfo[] | undefined,
  address: Address,
): Coin | undefined {
  if (isEth(address)) return { symbol: 'ETH', decimals: 18 }
  const same = (a: string) => a.toLowerCase() === address.toLowerCase()
  const listed = universe?.find((t) => same(t.address))
  if (listed) return listed
  const bundled = UNISWAP[chainId]
  if (bundled && same(bundled.weth)) return { symbol: 'WETH', decimals: 18 }
  if (bundled && same(bundled.usdc)) return { symbol: 'USDC', decimals: 6 }
  return undefined
}

export function useCoin(chainId: number, address: Address, offline = false): Coin | undefined {
  const universe = useTokenUniverse(chainId)
  const known = knownCoin(chainId, universe, address)
  const meta = useTokenMeta(chainId, known || !universe || offline ? undefined : address)
  return known ?? meta.data
}

/** Symbols for the addresses a route passes through. */
export function useSymbols(chainId: number) {
  const universe = useTokenUniverse(chainId)
  return (a: Address) => knownCoin(chainId, universe, a)?.symbol ?? shortAddress(a)
}

/** "v3 · USDC → WETH (0.05%) → DAI (0.3%)" */
export const routeText = (r: Route, symbol: (a: Address) => string) =>
  `${r.protocol} · ${r.path
    .map((a, i) => (i === 0 ? symbol(a) : `${symbol(a)} (${(r.fees[i - 1] ?? 0) / 10_000}%)`))
    .join(' → ')}`

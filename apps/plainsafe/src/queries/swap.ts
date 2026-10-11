// Swap quotes and contract checks (SPEC §3.13). Quotes are chain state: memory only, never stored.
import { useQuery } from '@tanstack/react-query'
import type { Route, SwapIntent, SwapPlan, UniswapContracts } from '@/core/uniswap'
import { run } from '@/effect/run'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { buildSwap, quoteSwap, requote, swapContracts } from '@/features/swap/program'
import { jsonWithBigints } from '@/lib/format'
import { keys } from './keys'

export function useSwapContracts(chainId: number) {
  return useQuery({
    queryKey: keys.swapContracts(chainId),
    queryFn: () => run(swapContracts(chainId)).then((c) => c ?? null),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSwapQuote(
  chainId: number,
  contracts: UniswapContracts | null | undefined,
  intent: SwapIntent | undefined,
) {
  return useQuery({
    queryKey: intent
      ? keys.swapQuote(chainId, intent.sell, intent.buy, intent.amountIn)
      : ['swap-quote', chainId, 'none'],
    queryFn: () =>
      contracts && intent
        ? run(quoteSwap(chainId, contracts, intent)).then((q) => q ?? null)
        : null,
    enabled: !!contracts && !!intent && intent.amountIn > 0n,
    // Prices move: a quote older than this is refreshed while the screen is open
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

const routeKey = (r: Route) => `${r.protocol}:${r.path.join('>')}:${r.fees.join(',')}`

/** A fresh quote for exactly the signed route (review and execute, SPEC §3.13). */
export function useRequote(
  chainId: number,
  contracts: UniswapContracts | null | undefined,
  route: Route | undefined,
  amountIn: bigint | undefined,
) {
  return useQuery({
    queryKey:
      route && amountIn !== undefined
        ? keys.requote(chainId, routeKey(route), amountIn)
        : ['requote', chainId, 'none'],
    queryFn: () =>
      contracts && route && amountIn !== undefined
        ? run(requote(chainId, contracts, route, amountIn))
        : null,
    enabled: !!contracts && !!route && amountIn !== undefined,
    staleTime: 15_000,
    // Kept fresh while the review (and its Execute button) is open
    refetchInterval: 30_000,
  })
}

/** The Safe transaction for a swap plan, with the TWAP check (SPEC §3.13). */
export function useBuiltSwap(
  safe: SafeSnapshot,
  contracts: UniswapContracts,
  plan: SwapPlan | undefined,
) {
  const version = safe.authenticity.status === 'verified' ? safe.authenticity.version : ''
  return useQuery({
    queryKey: keys.swapBuild(safe.chainId, safe.address, plan ? jsonWithBigints(plan) : 'none'),
    queryFn: () =>
      plan ? run(buildSwap(safe.chainId, version, contracts, plan)).then((c) => c ?? null) : null,
    enabled: !!plan,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

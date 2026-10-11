// Swap through Uniswap (SPEC §3.13, P1): quotes, the TWAP check and the batch, over RPC only.
import { Effect } from 'effect'
import { erc20Abi, getAddress, keccak256 } from 'viem'
import { needsDeployless, toViemChain } from '@/chains'
import type { TxCall } from '@/core/builders'
import { deployments } from '@/core/deployments'
import { encodeMultiSend } from '@/core/multisend'
import {
  bestQuote,
  candidateRoutes,
  isEth,
  meanTick,
  type Quote,
  quoteCall,
  type Route,
  type SwapIntent,
  type SwapPlan,
  shortfall,
  swapCalls,
  TWAP_SECONDS,
  TWAP_TOLERANCE,
  twapOutput,
  twapPools,
  UNISWAP,
  type UniswapContracts,
  v3PoolAbi,
} from '@/core/uniswap'
import { endpointOf, pinBlock, Rpc, rpcCall } from '@/effect/rpc'

const clientFor = (chainId: number) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const settings = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'swap')
    return {
      client,
      endpoint: endpointOf(settings),
      deployless: needsDeployless(toViemChain(settings)),
    }
  })

/**
 * The chain's Uniswap contracts, if every one has code (SPEC §3.13): otherwise the swap is
 * hidden on this chain.
 */
export const swapContracts = (chainId: number) =>
  Effect.gen(function* () {
    const c = UNISWAP[chainId]
    if (!c) return undefined
    const { client, endpoint } = yield* clientFor(chainId)
    // Every bundled contract (SPEC §3.13), USDC included: it's the middle hop of two-hop routes
    const addresses = [
      c.universalRouter,
      c.permit2,
      c.quoterV2,
      c.v4Quoter,
      c.v3Factory,
      c.weth,
      c.usdc,
    ]
    const codes = yield* rpcCall(endpoint, () =>
      Promise.all(addresses.map((address) => client.getCode({ address }))),
    )
    return codes.every((code) => !!code && code !== '0x') ? c : undefined
  })

export type TwapCheck =
  | { readonly kind: 'ok' | 'worse'; readonly shortfall: number }
  | { readonly kind: 'unavailable' }

interface SwapQuote {
  readonly block: bigint
  readonly best: Quote
  /** How many routes returned a quote, out of how many were asked. */
  readonly quoted: number
  readonly asked: number
  readonly twap: TwapCheck
}

/**
 * The 30-minute TWAP of each hop's v3 pool, turned into the output it implies. A missing pool or
 * too little price history (observe reverts) means no check for this route.
 */
const twapCheck = (
  chainId: number,
  c: UniswapContracts,
  route: Route,
  amountIn: bigint,
  amountOut: bigint,
  block: bigint,
) =>
  Effect.gen(function* () {
    const { client, endpoint, deployless } = yield* clientFor(chainId)
    const hops = twapPools(route, c)
    const results = yield* rpcCall(endpoint, () =>
      client.multicall({
        contracts: hops.map((h) => ({
          address: h.pool,
          abi: v3PoolAbi,
          functionName: 'observe' as const,
          args: [[TWAP_SECONDS, 0]] as const,
        })),
        allowFailure: true,
        blockNumber: block,
        deployless,
      }),
    )
    const ticks: number[] = []
    for (const r of results) {
      const [before, now] = r.status === 'success' ? r.result[0] : []
      if (before === undefined || now === undefined) return { kind: 'unavailable' } as const
      ticks.push(meanTick([before, now]))
    }
    const expected = twapOutput(
      amountIn,
      hops.map((h, i) => ({ ...h, tick: ticks[i] })),
    )
    const s = shortfall(amountOut, expected)
    const check: TwapCheck = { kind: s > TWAP_TOLERANCE ? 'worse' : 'ok', shortfall: s }
    return check
  })

/** One multicall of quoter calls at a pinned block; the best output wins (SPEC §3.13). */
export const quoteSwap = (chainId: number, c: UniswapContracts, intent: SwapIntent) =>
  Effect.gen(function* () {
    const { client, endpoint, deployless } = yield* clientFor(chainId)
    const block = yield* pinBlock(chainId, client, endpoint)
    const routes = candidateRoutes(intent, c)
    if (routes.length === 0) return undefined
    const results = yield* rpcCall(endpoint, () =>
      client.multicall({
        contracts: routes.map((r) => quoteCall(r, intent.amountIn, c)),
        allowFailure: true,
        blockNumber: block,
        deployless,
      }),
    )
    const quotes = routes.flatMap((route, i): Quote[] => {
      const r = results[i]
      return r?.status === 'success' ? [{ route, amountOut: r.result[0] }] : []
    })
    const best = bestQuote(quotes)
    if (!best) return undefined
    const twap = yield* twapCheck(chainId, c, best.route, intent.amountIn, best.amountOut, block)
    return {
      block,
      best,
      quoted: quotes.length,
      asked: routes.length,
      twap,
    } satisfies SwapQuote
  })

/** A fresh quote for exactly this route (review and execute, SPEC §3.13). */
export const requote = (chainId: number, c: UniswapContracts, route: Route, amountIn: bigint) =>
  Effect.gen(function* () {
    const { client, endpoint } = yield* clientFor(chainId)
    const block = yield* pinBlock(chainId, client, endpoint)
    const call = quoteCall(route, amountIn, c)
    const result = yield* rpcCall(endpoint, () =>
      client
        .simulateContract({ ...call, blockNumber: block } as Parameters<
          typeof client.simulateContract
        >[0])
        .then((r) => (r.result as readonly [bigint, ...unknown[]])[0])
        .catch(() => undefined),
    )
    return { block, amountOut: result }
  })

/**
 * A MultiSendCallOnly on this chain whose code matches its code hash (SPEC §4.2): the Safe's own
 * version first, then the others. Any version works with any Safe.
 */
const multiSendCallOnly = (chainId: number, version: string) =>
  Effect.gen(function* () {
    const { client, endpoint } = yield* clientFor(chainId)
    const candidates = [...deployments.multiSendCallOnly]
      .filter((m) => m.variant !== 'zksync')
      .sort((a, b) => Number(b.version === version) - Number(a.version === version))
    const codes = yield* rpcCall(endpoint, () =>
      Promise.all(candidates.map((m) => client.getCode({ address: m.address }))),
    )
    const found = candidates.find((m, i) => {
      const code = codes[i]
      return !!code && code !== '0x' && keccak256(code).toLowerCase() === m.codeHash.toLowerCase()
    })
    return found ? getAddress(found.address) : undefined
  })

/**
 * The Safe transaction for a swap: a single call when selling ETH, otherwise a batch by
 * delegatecall to a code-hash-verified MultiSendCallOnly (SPEC §3.13). Undefined when the chain
 * has no verified MultiSendCallOnly.
 */
export const buildSwap = (chainId: number, version: string, c: UniswapContracts, plan: SwapPlan) =>
  Effect.gen(function* () {
    const { client, endpoint } = yield* clientFor(chainId)
    const allowance = isEth(plan.intent.sell)
      ? 0n
      : yield* rpcCall(endpoint, () =>
          client.readContract({
            address: plan.intent.sell,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [plan.recipient, c.permit2],
          }),
        )
    const calls = swapCalls(plan, c, allowance)
    const [only] = calls
    if (calls.length === 1)
      return { to: only.to, value: only.value, data: only.data, operation: 0 } satisfies TxCall
    const batch = yield* multiSendCallOnly(chainId, version)
    // No verified MultiSendCallOnly on this chain: the swap can't be batched
    if (!batch) return undefined
    return {
      to: batch,
      value: 0n,
      data: encodeMultiSend(calls),
      operation: 1,
    } satisfies TxCall
  })

// Balances and display prices over RPC (SPEC §10, §10.1): one multicall at one pinned block.
import { Effect } from 'effect'
import { type Address, erc20Abi, parseAbi } from 'viem'
import { needsDeployless, toViemChain } from '@/chains'
import { aggregatorFor, FIAT_STABLES } from '@/core/prices'
import { endpointOf, pinBlock, Rpc, rpcCall } from '@/effect/rpc'
import type { TokenInfo } from '@/features/tokens/store'

const aggregatorAbi = parseAbi([
  'function getRateToEth(address srcToken, bool useSrcWrappers) view returns (uint256 weightedRate)',
])

interface TokenBalance {
  readonly token: TokenInfo
  readonly balance: bigint
  /** getRateToEth, when the aggregator could price it. */
  readonly rate?: bigint
}

interface Balances {
  readonly block: bigint
  readonly native: bigint
  readonly tokens: readonly TokenBalance[]
  /** False where the aggregator isn't deployed: prices are hidden there, not zeroed. */
  readonly priced: boolean
}

/**
 * Is the price aggregator deployed on this chain (SPEC §10.1)? Asked once per chain per session,
 * in the same batch as the first balance read, so it never costs a round trip of its own.
 */
const aggregatorKnown = new Map<number, boolean>()

export const loadBalances = (chainId: number, safe: Address, tokens: readonly TokenInfo[]) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const settings = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'balances')
    const endpoint = endpointOf(settings)
    const deployless = needsDeployless(toViemChain(settings))
    const block = yield* pinBlock(chainId, client, endpoint)
    const aggregator = aggregatorFor(chainId)
    const known = aggregatorKnown.get(chainId)
    // 1. Every balance, and the native balance, at the pinned block
    const [native, balanceResults, aggregatorCode] = yield* rpcCall(endpoint, () =>
      Promise.all([
        client.getBalance({ address: safe, blockNumber: block }),
        tokens.length
          ? client.multicall({
              contracts: tokens.map((t) => ({
                address: t.address,
                abi: erc20Abi,
                functionName: 'balanceOf' as const,
                args: [safe] as const,
              })),
              allowFailure: true,
              blockNumber: block,
              deployless,
            })
          : Promise.resolve([]),
        known === undefined ? client.getCode({ address: aggregator }) : Promise.resolve(undefined),
      ]),
    )
    const withPrices = known ?? (!!aggregatorCode && aggregatorCode !== '0x')
    aggregatorKnown.set(chainId, withPrices)
    const held = tokens.map((token, i) => {
      const r = balanceResults[i]
      return { token, balance: r?.status === 'success' ? r.result : 0n }
    })
    // 2. Prices only for tokens the Safe holds: getRateToEth is heavy, and lists can be long
    const nonZero = held.filter((h) => h.balance > 0n)
    const rates =
      withPrices && nonZero.length
        ? yield* rpcCall(endpoint, () =>
            client.multicall({
              contracts: nonZero.map((h) => ({
                address: aggregator,
                abi: aggregatorAbi,
                functionName: 'getRateToEth' as const,
                args: [h.token.address, true] as const,
              })),
              allowFailure: true,
              blockNumber: block,
              deployless,
            }),
          )
        : []
    const rateOf = new Map(nonZero.map((h, i) => [h.token.address, rates[i]]))
    const out: TokenBalance[] = held.map((h) => {
      const r = rateOf.get(h.token.address)
      return { ...h, ...(r?.status === 'success' && r.result > 0n ? { rate: r.result } : {}) }
    })
    return { block, native, tokens: out, priced: withPrices } satisfies Balances
  })

/** Fiat per ETH from Mainnet (SPEC §10.1): L2 balances in ETH are priced through it too. */
export const ethFiatRate = (currency: 'USD' | 'EUR') =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    // Fails with RpcError when Mainnet isn't set up: fiat values are then hidden.
    const settings = yield* rpc.chain(1)
    const client = yield* rpc.client(1, 'prices')
    const stable = FIAT_STABLES[currency]
    const rate = yield* rpcCall(endpointOf(settings), () =>
      client.readContract({
        address: aggregatorFor(1),
        abi: aggregatorAbi,
        functionName: 'getRateToEth',
        args: [stable.address, true],
      }),
    )
    return { rate, decimals: stable.decimals }
  })

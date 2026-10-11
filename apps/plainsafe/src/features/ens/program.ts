// ENS names over RPC (SPEC §8.5).
import { Effect } from 'effect'
import { type Address, getAddress } from 'viem'
import { normalize } from 'viem/ens'
import { coinTypeFor, ensChainFor } from '@/core/ens'
import { RpcError } from '@/effect/errors'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'

/** Address → name. The Universal Resolver only returns a name whose forward lookup matches. */
export const lookupName = (chainId: number, address: Address) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const ensChain = ensChainFor(chainId)
    const client = yield* rpc.client(ensChain, 'ens')
    const endpoint = endpointOf(yield* rpc.chain(ensChain))
    return yield* rpcCall(endpoint, () =>
      client.getEnsName({ address, coinType: coinTypeFor(chainId) }).catch((e: unknown) => {
        // A name the resolver can't produce (no primary name, off-chain with CCIP-read off, …)
        // is "no name", not an RPC failure.
        if (
          /reverted|OffchainLookup|CCIP|ResolverNotFound|ResolverError|disabled/i.test(
            String((e as Error)?.message),
          )
        )
          return null
        throw e
      }),
    )
  })

/** Name → address for the Safe's chain; never falls back to the Mainnet address (SPEC §8.5). */
export const resolveName = (chainId: number, name: string) =>
  Effect.gen(function* () {
    let normalized: string
    try {
      normalized = normalize(name)
    } catch {
      return yield* new RpcError({ endpoint: 'ENS', message: `“${name}” is not a valid ENS name.` })
    }
    const rpc = yield* Rpc
    const ensChain = ensChainFor(chainId)
    const client = yield* rpc.client(ensChain, 'ens')
    const endpoint = endpointOf(yield* rpc.chain(ensChain))
    const address = yield* rpcCall(endpoint, () =>
      client
        .getEnsAddress({ name: normalized, coinType: coinTypeFor(chainId) })
        .catch((e: unknown) => {
          if (/disabled/i.test(String((e as Error)?.message)))
            throw new Error(
              `${normalized} is stored off-chain (CCIP-read is disabled in Settings → Network access).`,
            )
          throw e
        }),
    )
    if (!address) {
      return yield* new RpcError({
        endpoint: 'ENS',
        message: `${normalized} has no address for this chain.`,
      })
    }
    return { name: normalized, address: getAddress(address) }
  })

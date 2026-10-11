// Token symbol and decimals over RPC (SPEC §3.3: decimals from the list or from RPC).
import { Effect } from 'effect'
import { type Address, erc20Abi, getAddress } from 'viem'
import { needsDeployless, toViemChain } from '@/chains'
import { RpcError } from '@/effect/errors'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'

interface TokenMeta {
  readonly address: Address
  readonly symbol: string
  readonly name?: string
  readonly decimals: number
}

export const tokenMeta = (chainId: number, token: Address) =>
  Effect.gen(function* () {
    const address = getAddress(token)
    const rpc = yield* Rpc
    const chain = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'token-meta')
    const endpoint = endpointOf(chain)
    const [symbol, name, decimals] = yield* rpcCall(endpoint, () =>
      client.multicall({
        contracts: [
          { address, abi: erc20Abi, functionName: 'symbol' },
          { address, abi: erc20Abi, functionName: 'name' },
          { address, abi: erc20Abi, functionName: 'decimals' },
        ],
        allowFailure: true,
        deployless: needsDeployless(toViemChain(chain)),
      }),
    )
    if (decimals.status !== 'success') {
      return yield* new RpcError({
        endpoint,
        message: `${address} doesn't look like an ERC-20 token (no decimals()).`,
      })
    }
    return {
      address,
      decimals: decimals.result,
      symbol: symbol.status === 'success' ? symbol.result.slice(0, 32) : '???',
      ...(name.status === 'success' ? { name: name.result.slice(0, 64) } : {}),
    } satisfies TokenMeta
  })

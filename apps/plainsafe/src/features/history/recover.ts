// Details of an executed L1 multisig transaction (SPEC §11): the transaction that emitted the
// event, by hash, or by block and index when the node has no transaction index.
import { Effect } from 'effect'
import type { Hex } from 'viem'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'

export const executingTransaction = (
  chainId: number,
  hash: Hex,
  blockNumber: bigint,
  transactionIndex: number | undefined,
) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const client = yield* rpc.client(chainId, 'history')
    const endpoint = endpointOf(yield* rpc.chain(chainId))
    const byHash = yield* Effect.either(rpcCall(endpoint, () => client.getTransaction({ hash })))
    if (byHash._tag === 'Right')
      return { input: byHash.right.input, to: byHash.right.to, from: byHash.right.from }
    if (transactionIndex === undefined) return yield* Effect.fail(byHash.left)
    const block = yield* rpcCall(endpoint, () =>
      client.getBlock({ blockNumber, includeTransactions: true }),
    )
    const tx = block.transactions[transactionIndex]
    if (!tx || tx.hash.toLowerCase() !== hash.toLowerCase()) return yield* Effect.fail(byHash.left)
    return { input: tx.input, to: tx.to, from: tx.from }
  })

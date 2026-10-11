// Onchain approvals (SPEC §5.2, P1): owners who called approveHash(safeTxHash) count as signers.
import { Effect } from 'effect'
import { type Address, type Hex, parseAbi } from 'viem'
import { needsDeployless, toViemChain } from '@/chains'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'

export const approveHashAbi = parseAbi([
  'function approveHash(bytes32 hashToApprove)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
])

/** Owners with approvedHashes(owner, safeTxHash) != 0, read at the Safe's pinned block. */
export const readApprovals = (
  chainId: number,
  safe: Address,
  owners: readonly Address[],
  safeTxHash: Hex,
  block: bigint,
) =>
  Effect.gen(function* () {
    if (owners.length === 0) return []
    const rpc = yield* Rpc
    const chain = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'approvals')
    const results = yield* rpcCall(endpointOf(chain), () =>
      client.multicall({
        contracts: owners.map((owner) => ({
          address: safe,
          abi: approveHashAbi,
          functionName: 'approvedHashes' as const,
          args: [owner, safeTxHash] as const,
        })),
        blockNumber: block,
        allowFailure: false,
        deployless: needsDeployless(toViemChain(chain)),
      }),
    )
    return owners.filter((_, i) => results[i] !== 0n)
  })

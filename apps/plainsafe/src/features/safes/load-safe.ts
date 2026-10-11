// Loading and verifying a Safe (SPEC §3.2, §4.2, §8.4): everything is read at one pinned block.
import { Data, Effect } from 'effect'
import { type Address, getAddress, parseAbi } from 'viem'
import { needsDeployless, toViemChain } from '@/chains'
import { type Authenticity, checkAuthenticity } from '@/core/authenticity'
import { deployments } from '@/core/deployments'
import { SLOT, singletonFromSlot0, slot } from '@/core/safe-layout'
import { endpointOf, pinBlock, Rpc, rpcCall } from '@/effect/rpc'

export class NotAContract extends Data.TaggedError('NotAContract')<{
  readonly chainId: number
  readonly address: Address
}> {}

const safeAbi = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function VERSION() view returns (string)',
])

export interface SafeSnapshot {
  readonly chainId: number
  readonly address: Address
  /** Every value below was read at this block. */
  readonly block: bigint
  readonly authenticity: Authenticity
  readonly singleton: Address
  /** What VERSION() returned: information only (SPEC §4.2). */
  readonly reportedVersion?: string
  readonly owners?: readonly Address[]
  readonly threshold?: bigint
  readonly nonce?: bigint
  readonly balance: bigint
}

export const loadSafe = (chainId: number, rawAddress: Address) =>
  Effect.gen(function* () {
    const address = getAddress(rawAddress)
    const rpc = yield* Rpc
    const settings = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'safe')
    const endpoint = endpointOf(settings)
    const chain = toViemChain(settings)

    // Pin one block; always the latest, so pins never age past what full nodes keep (§8.4).
    const block = yield* pinBlock(chainId, client, endpoint)
    const [proxyCode, slot0, balance, reads] = yield* rpcCall(endpoint, () =>
      Promise.all([
        client.getCode({ address, blockNumber: block }),
        client.getStorageAt({ address, slot: slot(SLOT.singleton), blockNumber: block }),
        client.getBalance({ address, blockNumber: block }),
        client.multicall({
          contracts: [
            { address, abi: safeAbi, functionName: 'getOwners' },
            { address, abi: safeAbi, functionName: 'getThreshold' },
            { address, abi: safeAbi, functionName: 'nonce' },
            { address, abi: safeAbi, functionName: 'VERSION' },
          ],
          allowFailure: true,
          blockNumber: block,
          deployless: needsDeployless(chain),
        }),
      ]),
    )
    if (!proxyCode || proxyCode === '0x') return yield* new NotAContract({ chainId, address })

    const singleton = getAddress(singletonFromSlot0(slot0 ?? '0x'))
    const singletonCode = yield* rpcCall(endpoint, () =>
      client.getCode({ address: singleton, blockNumber: block }),
    )
    const [owners, threshold, nonce, version] = reads
    const reportedVersion = version.status === 'success' ? version.result : undefined
    const authenticity = checkAuthenticity(deployments, {
      proxyCode,
      singleton,
      singletonCode,
      reportedVersion,
    })
    return {
      chainId,
      address,
      block,
      authenticity,
      singleton,
      balance,
      ...(reportedVersion !== undefined ? { reportedVersion } : {}),
      ...(owners.status === 'success' ? { owners: owners.result.map((o) => getAddress(o)) } : {}),
      ...(threshold.status === 'success' ? { threshold: threshold.result } : {}),
      ...(nonce.status === 'success' ? { nonce: nonce.result } : {}),
    } satisfies SafeSnapshot
  })

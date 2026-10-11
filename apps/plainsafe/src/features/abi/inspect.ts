// whatsabi checks that need only the RPC (SPEC §7.3): code present, proxies followed to the
// implementation, selectors in the bytecode. Remote ABI loaders and signature lookups are off.
import { whatsabi } from '@shazow/whatsabi'
import { Effect } from 'effect'
import { type Address, getAddress, type Hex, keccak256 } from 'viem'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'
import { selectorsOf } from './selectors'

export interface ContractInspection {
  readonly address: Address
  readonly hasCode: boolean
  /** keccak256 of the target's own code (not the implementation's), e.g. to recognize MultiSend. */
  readonly codeHash?: Hex
  /** EIP-7702 delegated account: an EOA with delegation code. */
  readonly delegatedTo?: Address
  /** The implementation after following proxies (the address itself if not a proxy). */
  readonly implementation: Address
  readonly implementationCodeHash?: Hex
  /** True when whatsabi followed a proxy to a different implementation. */
  readonly isProxy: boolean
  /** 4-byte selectors found in the implementation's bytecode. */
  readonly selectors: readonly Hex[]
}

const DELEGATION_PREFIX = '0xef0100'
const result = (r: ContractInspection): ContractInspection => r

export const inspectContract = (chainId: number, rawAddress: Address) =>
  Effect.gen(function* () {
    const address = getAddress(rawAddress)
    const rpc = yield* Rpc
    const client = yield* rpc.client(chainId, 'whatsabi')
    const endpoint = endpointOf(yield* rpc.chain(chainId))
    const code = yield* rpcCall(endpoint, () => client.getCode({ address }))
    if (!code || code === '0x') {
      return result({
        address,
        hasCode: false,
        implementation: address,
        isProxy: false,
        selectors: [],
      })
    }
    // EIP-7702 delegation designator: 0xef0100 followed by the 20-byte address
    if (code.startsWith(DELEGATION_PREFIX) && code.length === DELEGATION_PREFIX.length + 40) {
      return result({
        address,
        hasCode: true,
        codeHash: keccak256(code),
        delegatedTo: getAddress(`0x${code.slice(DELEGATION_PREFIX.length)}`),
        implementation: address,
        isProxy: false,
        selectors: [],
      })
    }
    // whatsabi fetches code itself: hand it what we already have, and keep what it fetches
    // (the implementation's), so no address's code is read twice
    const codes = new Map<string, string>([[address.toLowerCase(), code]])
    const base = whatsabi.providers.CompatibleProvider(client)
    const provider = Object.create(base) as typeof base
    provider.getCode = async (a: string) => {
      const hit = codes.get(a.toLowerCase())
      if (hit !== undefined) return hit
      const fetched = await base.getCode(a)
      codes.set(a.toLowerCase(), fetched)
      return fetched
    }
    const loaded = yield* rpcCall(endpoint, () =>
      whatsabi.autoload(address, {
        provider,
        abiLoader: false,
        signatureLookup: false,
        followProxies: true,
        onError: () => false,
      }),
    )
    const implementation = getAddress(loaded.address)
    const implCode =
      (codes.get(implementation.toLowerCase()) as Hex | undefined) ??
      (yield* rpcCall(endpoint, () => client.getCode({ address: implementation })))
    return result({
      address,
      hasCode: true,
      codeHash: keccak256(code),
      implementation,
      ...(implCode && implCode !== '0x' ? { implementationCodeHash: keccak256(implCode) } : {}),
      // whatsabi stays at the target when it can't follow a proxy pattern (the Safe ProxyFactory)
      isProxy: implementation !== address,
      selectors: selectorsOf(loaded, implCode),
    })
  })

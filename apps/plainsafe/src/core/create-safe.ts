// Creating a Safe (SPEC §3.14): which contracts, the setup call, and the new Safe's address.
// Pure. Before anything is sent, the program checks every contract here by its code hash on the
// chain, and the address predicted here must match what the factory returns and then emits.
import {
  type Address,
  concat,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  parseAbi,
  zeroAddress,
} from 'viem'
import { type ContractInfo, deployments } from './deployments'
import { SENTINEL } from './safe-layout'

/** The version new Safes get: the most widely deployed, at the same address on most chains. */
const CREATE_VERSION = '1.4.1'

/**
 * Ethereum's L1s get the plain Safe. Every other chain gets SafeL2, which emits an event for
 * every transaction, so indexers and our history scan (§11) don't need traces there.
 */
const L1_CHAINS: ReadonlySet<number> = new Set([1, 11155111])
export const usesL2 = (chainId: number) => !L1_CHAINS.has(chainId)

export const safeSetupAbi = parseAbi([
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
])
export const proxyFactoryAbi = parseAbi([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address indexed proxy, address singleton)',
])

interface CreationContracts {
  readonly version: string
  readonly l2: boolean
  readonly singleton: ContractInfo
  readonly factory: ContractInfo & { readonly proxyCreationCode: Hex }
  readonly fallbackHandler: ContractInfo
}

/** The canonical v1.4.1 singleton (Safe or SafeL2), proxy factory and fallback handler. */
export function creationContracts(chainId: number): CreationContracts {
  const l2 = usesL2(chainId)
  const canonical = (c: { version: string; variant: string }) =>
    c.version === CREATE_VERSION && c.variant === 'canonical'
  // (typed through ContractInfo: the table's type intersects two singleton list types)
  const singletons: readonly (ContractInfo & { readonly l2: boolean })[] = deployments.singletons
  const singleton = singletons.find((s) => canonical(s) && s.l2 === l2)
  const factory = deployments.proxyFactories.find(canonical)
  const fallbackHandler = deployments.fallbackHandlers.find(canonical)
  if (!singleton || !factory?.proxyCreationCode || !fallbackHandler)
    throw new Error(`The bundled safe-deployments table has no v${CREATE_VERSION} contracts.`)
  return {
    version: CREATE_VERSION,
    l2,
    singleton,
    factory: { ...factory, proxyCreationCode: factory.proxyCreationCode },
    fallbackHandler,
  }
}

/** What's wrong with these owners and threshold, in words (GS200–GS204 before they happen). */
export function ownersProblem(owners: readonly Address[], threshold: number): string | undefined {
  if (owners.length === 0) return 'Add at least one owner.'
  const seen = new Set<string>()
  for (const o of owners) {
    const lower = o.toLowerCase()
    if (o === zeroAddress || lower === SENTINEL) return `${o} can't be an owner.`
    if (seen.has(lower)) return `${o} is listed twice.`
    seen.add(lower)
  }
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length)
    return `The threshold must be between 1 and ${owners.length}.`
  return undefined
}

export interface CreationPlan {
  readonly chainId: number
  readonly contracts: CreationContracts
  readonly owners: readonly Address[]
  readonly threshold: number
  readonly saltNonce: bigint
  /** The Safe's setup call, run by the factory in the same transaction. */
  readonly initializer: Hex
  /** The transaction the wallet sends: `to` the factory, with this data and no value. */
  readonly to: Address
  readonly data: Hex
  /** The new Safe's address, known before anything is sent (CREATE2). */
  readonly address: Address
}

/** setup(): no modules, no payment, the v1.4.1 compatibility fallback handler. */
const setupData = (owners: readonly Address[], threshold: number, fallbackHandler: Address) =>
  encodeFunctionData({
    abi: safeSetupAbi,
    functionName: 'setup',
    args: [
      owners,
      BigInt(threshold),
      zeroAddress,
      '0x',
      fallbackHandler,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  })

/** The factory's CREATE2: salt = keccak(keccak(initializer) ‖ saltNonce), code = creation ‖ singleton. */
export function predictSafeAddress(args: {
  readonly factory: Address
  readonly proxyCreationCode: Hex
  readonly singleton: Address
  readonly initializer: Hex
  readonly saltNonce: bigint
}): Address {
  const salt = keccak256(
    concat([
      keccak256(args.initializer),
      encodeAbiParameters([{ type: 'uint256' }], [args.saltNonce]),
    ]),
  )
  const bytecode = concat([
    args.proxyCreationCode,
    encodeAbiParameters([{ type: 'address' }], [args.singleton]),
  ])
  return getContractAddress({ opcode: 'CREATE2', from: args.factory, salt, bytecode })
}

export function planCreation(args: {
  readonly chainId: number
  readonly owners: readonly Address[]
  readonly threshold: number
  readonly saltNonce: bigint
}): CreationPlan {
  const problem = ownersProblem(args.owners, args.threshold)
  if (problem) throw new Error(problem)
  const contracts = creationContracts(args.chainId)
  const initializer = setupData(args.owners, args.threshold, contracts.fallbackHandler.address)
  return {
    ...args,
    contracts,
    initializer,
    to: contracts.factory.address,
    data: encodeFunctionData({
      abi: proxyFactoryAbi,
      functionName: 'createProxyWithNonce',
      args: [contracts.singleton.address, initializer, args.saltNonce],
    }),
    address: predictSafeAddress({
      factory: contracts.factory.address,
      proxyCreationCode: contracts.factory.proxyCreationCode,
      singleton: contracts.singleton.address,
      initializer,
      saltNonce: args.saltNonce,
    }),
  }
}

/** The proxy the factory created, from its ProxyCreation event in the receipt. */
export function createdSafe(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  factory: Address,
): Address | undefined {
  for (const log of logs) {
    if (!isAddressEqual(log.address, factory)) continue
    try {
      const e = decodeEventLog({
        abi: proxyFactoryAbi,
        eventName: 'ProxyCreation',
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      })
      return e.args.proxy
    } catch {
      // another event from the factory
    }
  }
  return undefined
}

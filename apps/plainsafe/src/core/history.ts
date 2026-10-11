// Onchain history (SPEC §11, P1): pure pieces of the backwards log scan. Event layouts come from
// the safe-deployments ABIs: v1.3.0 doesn't index most arguments, v1.4.1+ does, and v1.5.0
// adds ChangedModuleGuard.
import {
  type Address,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  type Hex,
  parseAbi,
} from 'viem'
import { execAbi } from './execution'
import type { ErrorInfo } from './rpc-errors'
import { type SafeTx, safeTxHashes } from './safe-tx'

const common = [
  'event ApproveHash(bytes32 indexed approvedHash, address indexed owner)',
  // Logged in the Safe's context by SafeMigration when a Safe changes singleton (an upgrade)
  'event ChangedMasterCopy(address singleton)',
  'event ChangedThreshold(uint256 threshold)',
  'event ExecutionFromModuleFailure(address indexed module)',
  'event ExecutionFromModuleSuccess(address indexed module)',
  'event SafeModuleTransaction(address module, address to, uint256 value, bytes data, uint8 operation)',
  'event SafeMultiSigTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo)',
  'event SafeReceived(address indexed sender, uint256 value)',
  'event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)',
  'event SignMsg(bytes32 indexed msgHash)',
] as const

export const safeEventsV130 = parseAbi([
  ...common,
  'event AddedOwner(address owner)',
  'event ChangedFallbackHandler(address handler)',
  'event ChangedGuard(address guard)',
  'event DisabledModule(address module)',
  'event EnabledModule(address module)',
  'event ExecutionFailure(bytes32 txHash, uint256 payment)',
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
  'event RemovedOwner(address owner)',
])

export const safeEventsV141 = parseAbi([
  ...common,
  'event AddedOwner(address indexed owner)',
  'event ChangedFallbackHandler(address indexed handler)',
  'event ChangedGuard(address indexed guard)',
  'event ChangedModuleGuard(address indexed moduleGuard)',
  'event DisabledModule(address indexed module)',
  'event EnabledModule(address indexed module)',
  'event ExecutionFailure(bytes32 indexed txHash, uint256 payment)',
  'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
  'event RemovedOwner(address indexed owner)',
])

/** JSON-safe event arguments: bigints as decimal strings, bytes and addresses as hex. */
type EventArgs = Record<string, string | number | boolean | readonly string[]>

interface SafeEvent {
  readonly name: string
  readonly args: EventArgs
}

const toJson = (v: unknown): string | number | boolean | readonly string[] =>
  typeof v === 'bigint'
    ? v.toString()
    : Array.isArray(v)
      ? v.map((x) => String(toJson(x)))
      : typeof v === 'number' || typeof v === 'boolean'
        ? v
        : String(v)

/** A Safe event from a log, trying the version's layout first. Unknown logs give undefined. */
export function decodeSafeLog(
  log: { readonly topics: readonly Hex[]; readonly data: Hex },
  version: string,
): SafeEvent | undefined {
  const abis =
    version === '1.3.0' ? [safeEventsV130, safeEventsV141] : [safeEventsV141, safeEventsV130]
  for (const abi of abis) {
    try {
      const e = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      const args = Object.fromEntries(
        Object.entries((e.args ?? {}) as Record<string, unknown>).map(([k, v]) => [k, toJson(v)]),
      )
      return { name: e.eventName, args }
    } catch {
      // another layout
    }
  }
  return undefined
}

export const isExecution = (name: string) =>
  name === 'ExecutionSuccess' || name === 'ExecutionFailure'

// ---------- scanning ----------

export const INITIAL_CHUNK = 100_000n
export const MAX_CHUNK = 1_000_000n

export type LogErrorKind = 'range' | 'refused' | 'temporary'

const RANGE =
  /block range|max(imum)? (block )?range|range (is )?too (large|wide|big)|ranges? over|limited to|exceed(s|ed)? .*(range|blocks|results)|too many (results|logs|blocks)|query returned more than|response size|log response/i
const REFUSED =
  /4444|pruned|history (is )?(not )?available|archive|not supported|method not found|not allowed|not whitelisted|does not exist/i

/**
 * How a failed eth_getLogs is handled (SPEC §11): range errors halve the chunk, refusals end the
 * scan as "unavailable", anything else (timeouts, 429s, odd errors) is retried.
 */
export function classifyLogError(info: ErrorInfo): LogErrorKind {
  if (info.status === 429 || info.code === 429) return 'temporary'
  if (RANGE.test(info.message)) return 'range'
  if (REFUSED.test(info.message) || info.code === -32601) return 'refused'
  return 'temporary'
}

export const smallerChunk = (size: bigint) => (size > 1n ? size / 2n : 0n)
export const largerChunk = (size: bigint) => (size * 2n > MAX_CHUNK ? MAX_CHUNK : size * 2n)

type HistoryStatus =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Whether the stored history is complete (SPEC §11): the Safe's creation was found, and every
 * nonce it used has an ExecutionSuccess or ExecutionFailure.
 */
export function completeness(args: {
  setupFound: boolean
  executions: number
  onchainNonce: bigint
  floorReached: boolean
}): HistoryStatus {
  if (!args.setupFound)
    return {
      kind: 'incomplete',
      reason: args.floorReached
        ? "The scan reached the Safe version's deploy block without finding the Safe's creation."
        : "The Safe's creation hasn't been found yet.",
    }
  if (BigInt(args.executions) !== args.onchainNonce)
    return {
      kind: 'incomplete',
      reason: `Found ${args.executions} executions, but the Safe's nonce is ${args.onchainNonce}.`,
    }
  return { kind: 'complete' }
}

// ---------- recovering executed transactions ----------

/** L2 Safes log every parameter: SafeMultiSigTransaction (SPEC §11). */
export function txFromL2Event(args: EventArgs): { tx: SafeTx; signatures: Hex } | undefined {
  try {
    const [nonce] = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
      args.additionalInfo as Hex,
    )
    return {
      tx: {
        to: getAddress(args.to as string),
        value: BigInt(args.value as string),
        data: args.data as Hex,
        operation: Number(args.operation) === 1 ? 1 : 0,
        safeTxGas: BigInt(args.safeTxGas as string),
        baseGas: BigInt(args.baseGas as string),
        gasPrice: BigInt(args.gasPrice as string),
        gasToken: getAddress(args.gasToken as string),
        refundReceiver: getAddress(args.refundReceiver as string),
        nonce,
      },
      signatures: args.signatures as Hex,
    }
  } catch {
    return undefined
  }
}

/**
 * L1 Safes: decode execTransaction calldata sent straight to this Safe. The nonce isn't in the
 * calldata, so it's `nonceGuess` (from counting later executions), checked by recomputing the
 * safeTxHash against the event's. Nearby nonces are tried in case the count is off. The
 * signatures come along, as from txFromL2Event.
 */
export function txFromCalldata(args: {
  input: Hex
  to: Address | null | undefined
  chainId: number
  safe: Address
  safeTxHash: Hex
  nonceGuess: bigint
}): { tx: SafeTx; signatures: Hex } | undefined {
  if (!args.to || args.to.toLowerCase() !== args.safe.toLowerCase()) return undefined
  let decoded: ReturnType<typeof decodeFunctionData<typeof execAbi>>
  try {
    decoded = decodeFunctionData({ abi: execAbi, data: args.input })
  } catch {
    return undefined
  }
  const [
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
  ] = decoded.args
  for (const delta of [0n, -1n, 1n, -2n, 2n]) {
    const nonce = args.nonceGuess + delta
    if (nonce < 0n) continue
    const tx: SafeTx = {
      to,
      value,
      data,
      operation: operation === 1 ? 1 : 0,
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      refundReceiver,
      nonce,
    }
    if (
      safeTxHashes(args.chainId, args.safe, tx).safeTx.toLowerCase() ===
      args.safeTxHash.toLowerCase()
    )
      return { tx, signatures }
  }
  return undefined
}

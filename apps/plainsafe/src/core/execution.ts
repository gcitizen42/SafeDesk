// Executing a Safe transaction (SPEC §3.8): signature assembly, execTransaction, events, errors.
import {
  type Abi,
  type Address,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Hex,
  type Log,
  parseAbi,
} from 'viem'
import { GS_ERRORS } from './gs-errors'
import { causes } from './rpc-errors'
import type { SafeTx } from './safe-tx'
import { encodeSignatures, prevalidatedSignature } from './signatures'

export const execAbi = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)',
])

// v1.3.0 has txHash in data; v1.4.1+ indexes it. topics[0] is the same (SPEC §4.1).
const eventsV130 = parseAbi([
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 txHash, uint256 payment)',
])
const eventsV141 = parseAbi([
  'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 indexed txHash, uint256 payment)',
])

type ExecutionPlan =
  | { readonly kind: 'ready'; readonly signatures: Hex; readonly prevalidatedFor?: Address }
  | { readonly kind: 'missing'; readonly missing: number }

/**
 * Anyone can execute with ≥ threshold owner signatures. An owner who hasn't signed can supply the
 * last one as a pre-validated signature, since they send the transaction (SPEC §3.8). Owners who
 * approved the hash onchain count too, encoded the same way (SPEC §5.2, P1).
 */
export function planExecution(args: {
  signatures: readonly { signer: Address; data: Hex }[]
  owners: readonly Address[]
  threshold: bigint
  executor?: Address | undefined
  /** Owners with approvedHashes(owner, safeTxHash) != 0 at the pinned block. */
  approvedBy?: readonly Address[] | undefined
}): ExecutionPlan {
  const owners = new Set(args.owners.map((o) => o.toLowerCase()))
  const offChain = args.signatures.filter((s) => owners.has(s.signer.toLowerCase()))
  const signed = new Set(offChain.map((s) => s.signer.toLowerCase()))
  const prevalidated = (owner: Address) => {
    const signer = getAddress(owner)
    return { signer, data: prevalidatedSignature(signer) }
  }
  const approvals = (args.approvedBy ?? [])
    .filter((a) => owners.has(a.toLowerCase()) && !signed.has(a.toLowerCase()))
    .map(prevalidated)
  const valid = [...offChain, ...approvals]
  const have = BigInt(valid.length)
  if (have >= args.threshold) return { kind: 'ready', signatures: encodeSignatures(valid) }
  const executor = args.executor
  if (
    executor &&
    have + 1n === args.threshold &&
    owners.has(executor.toLowerCase()) &&
    !valid.some((s) => s.signer.toLowerCase() === executor.toLowerCase())
  ) {
    const last = prevalidated(executor)
    return {
      kind: 'ready',
      signatures: encodeSignatures([...valid, last]),
      prevalidatedFor: last.signer,
    }
  }
  return { kind: 'missing', missing: Number(args.threshold - have) }
}

export function execTransactionData(tx: SafeTx, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: execAbi,
    functionName: 'execTransaction',
    args: [
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      signatures,
    ],
  })
}

/** Find ExecutionSuccess/ExecutionFailure for our safeTxHash in a receipt's logs. */
export function executionOutcome(
  logs: readonly Log[],
  safe: Address,
  safeTxHash: Hex,
): 'executed' | 'failed' | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== safe.toLowerCase()) continue
    for (const abi of [eventsV141, eventsV130]) {
      try {
        const e = decodeEventLog({ abi, data: log.data, topics: log.topics })
        if ((e.args as { txHash: Hex }).txHash.toLowerCase() === safeTxHash.toLowerCase()) {
          return e.eventName === 'ExecutionSuccess' ? 'executed' : 'failed'
        }
      } catch {
        // not this shape
      }
    }
  }
  return undefined
}

const PANIC: Record<number, string> = {
  1: 'assertion failed',
  17: 'arithmetic overflow or underflow',
  18: 'division by zero',
  33: 'invalid enum value',
  34: 'invalid storage byte array',
  49: 'pop on an empty array',
  50: 'array index out of bounds',
  65: 'out of memory',
  81: 'call to an invalid internal function',
}

/**
 * Plain language for a failed execTransaction estimate (SPEC §3.8). v1.3.0 and v1.4.1 report
 * the inner call's failure as GS013; v1.5.0 passes the inner revert data through, so it may
 * be Error(string), Panic, or a custom error of the target.
 */
export function translateRevert(data: Hex | undefined, targetAbi?: Abi): string {
  if (!data || data === '0x') return 'The transaction reverted without a reason.'
  try {
    const e = decodeErrorResult({ abi: targetAbi ?? [], data })
    if (e.errorName === 'Error') {
      const reason = String(e.args?.[0] ?? '')
      const gs = /^GS\d{3}$/.test(reason) ? GS_ERRORS[reason] : undefined
      if (gs) return `${reason}: ${gs}.`
      return `The call reverted: “${reason}”.`
    }
    if (e.errorName === 'Panic') {
      const code = Number(e.args?.[0] ?? 0)
      return `The call panicked: ${PANIC[code] ?? `code 0x${code.toString(16)}`}.`
    }
    const args = (e.args ?? [])
      .map((a) => (typeof a === 'bigint' ? a.toString() : String(a)))
      .join(', ')
    return `The call reverted with ${e.errorName}(${args}).`
  } catch {
    return `The call reverted with unknown error data ${data.slice(0, 10)}${data.length > 10 ? '…' : ''}.`
  }
}

/** Revert data from a viem error, wherever it is in the cause chain. */
export function revertData(error: unknown): Hex | undefined {
  for (const c of causes(error)) {
    const d = (c as { data?: unknown }).data
    if (typeof d === 'string' && d.startsWith('0x')) return d as Hex
    if (d && typeof d === 'object' && typeof (d as { data?: unknown }).data === 'string')
      return (d as { data: Hex }).data
  }
  const m = /(0x08c379a0[0-9a-fA-F]*|0x4e487b71[0-9a-fA-F]{64})/.exec(
    String((error as Error)?.message ?? ''),
  )
  return m?.[1] as Hex | undefined
}

/** Whether a failed call or estimate reverted, rather than the RPC failing. */
export const isRevert = (error: unknown) =>
  !!revertData(error) || /revert/i.test(String((error as Error)?.message ?? ''))

/** 20% over the estimate, so the transaction still fits if state changes before it's mined. */
export const withGasHeadroom = (gas: bigint) => (gas * 12n) / 10n

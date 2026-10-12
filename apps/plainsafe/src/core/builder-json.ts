import {
  type AbiFunction,
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddress,
  isHex,
  size,
} from 'viem'
import type { SafeTxPackage } from '@/schemas/package'
import { parseArg } from './abi-args'
import { completeTx } from './builders'
import { encodeMultiSend } from './multisend'
import { type SafeTx, safeTxHashes, safeTxTypedData } from './safe-tx'

const fields = [
  'to',
  'value',
  'data',
  'operation',
  'safeTxGas',
  'baseGas',
  'gasPrice',
  'gasToken',
  'refundReceiver',
  'nonce',
] as const
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a JSON object')
  return v as Record<string, unknown>
}
const uint = (v: unknown): bigint => {
  if (
    (typeof v !== 'string' || v.length > 78 || !/^(0|[1-9]\d*)$/.test(v)) &&
    (typeof v !== 'number' || !Number.isSafeInteger(v))
  )
    throw new Error('Expected a whole unsigned number')
  const n = BigInt(v as string | number)
  if (n < 0n || n >= 2n ** 256n) throw new Error('Number outside uint256 range')
  return n
}
const address = (v: unknown): Address => {
  if (typeof v !== 'string' || !isAddress(v, { strict: true })) throw new Error('Invalid address')
  return getAddress(v)
}
const bytes = (v: unknown): Hex => {
  if (typeof v !== 'string' || !isHex(v) || v.length % 2 !== 0 || size(v) > 256 * 1024)
    throw new Error('Invalid or oversized calldata')
  return v
}
const operation = (v: unknown): 0 | 1 => {
  if (v !== 0 && v !== 1 && v !== '0' && v !== '1')
    throw new Error('Operation must be CALL (0) or DELEGATECALL (1)')
  return Number(v) as 0 | 1
}

export function parseSafeTx(input: unknown): SafeTx {
  const v = object(input)
  for (const f of fields) if (v[f] === undefined) throw new Error(`Missing SafeTx field: ${f}`)
  return {
    to: address(v.to),
    value: uint(v.value),
    data: bytes(v.data),
    operation: operation(v.operation),
    safeTxGas: uint(v.safeTxGas),
    baseGas: uint(v.baseGas),
    gasPrice: uint(v.gasPrice),
    gasToken: address(v.gasToken),
    refundReceiver: address(v.refundReceiver),
    nonce: uint(v.nonce),
  }
}

function checkedParam(value: unknown, depth = 0): AbiFunction['inputs'][number] {
  const p = object(value)
  if (
    depth > 6 ||
    typeof p.name !== 'string' ||
    !/^\w{1,128}$/.test(p.name) ||
    typeof p.type !== 'string' ||
    p.type.length > 128
  )
    throw new Error('Invalid ABI parameter')
  const base = p.type.split('[')[0] ?? '',
    suffix = p.type.slice(base.length)
  if (
    !/^(address|bool|string|tuple|bytes([1-9]|[12]\d|3[012])?|u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?)$/.test(
      base,
    ) ||
    !/^(\[\d{0,4}\])*$/.test(suffix) ||
    suffix.split('[').length > 7
  )
    throw new Error('Unsupported ABI parameter type')
  if (base === 'tuple') {
    if (!Array.isArray(p.components) || !p.components.length || p.components.length > 64)
      throw new Error('Invalid tuple components')
    return {
      name: p.name,
      type: p.type,
      components: p.components.map((c) => checkedParam(c, depth + 1)),
    } as AbiFunction['inputs'][number]
  }
  return { name: p.name, type: p.type } as AbiFunction['inputs'][number]
}

function encodedCall(tx: Record<string, unknown>): Hex {
  if (tx.data !== null && tx.data !== undefined) return bytes(tx.data)
  if (!tx.contractMethod) return '0x'
  const method = object(tx.contractMethod),
    values = object(tx.contractInputsValues ?? {})
  if (
    typeof method.name !== 'string' ||
    !/^\w{1,128}$/.test(method.name) ||
    !Array.isArray(method.inputs) ||
    method.inputs.length > 64
  )
    throw new Error('Invalid contract method')
  const inputs = method.inputs.map((p) => checkedParam(p))
  const args = inputs.map((p, i) => {
    if (
      typeof p.type !== 'string' ||
      p.type.length > 128 ||
      !p.name ||
      values[p.name] === undefined
    )
      throw new Error(`Missing method input ${i}`)
    const value = values[p.name]
    return parseArg(p, typeof value === 'string' ? value : JSON.stringify(value), p.name)
  })
  return encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: method.name,
        stateMutability: method.payable ? 'payable' : 'nonpayable',
        inputs,
        outputs: [],
      },
    ],
    functionName: method.name,
    args,
  })
}

export function importBuilderJson(
  input: unknown,
  context: { chainId: number; safe: Address; nonce: bigint; multiSend?: Address },
): SafeTx {
  const doc = object(input),
    domain = doc.domain ? object(doc.domain) : undefined,
    meta = doc.meta ? object(doc.meta) : undefined
  const chainId = domain?.chainId ?? doc.chainId
  if (chainId !== undefined && uint(chainId) !== BigInt(context.chainId))
    throw new Error('JSON belongs to a different chain')
  const safe = domain?.verifyingContract ?? doc.safe ?? meta?.createdFromSafeAddress
  if (safe !== undefined && address(safe) !== getAddress(context.safe))
    throw new Error('JSON belongs to a different Safe')
  if (doc.message || doc.tx || doc.to) {
    const tx = parseSafeTx(doc.message ?? doc.tx ?? doc)
    const hash = safeTxHashes(context.chainId, context.safe, tx).safeTx
    if (typeof doc.safeTxHash === 'string' && doc.safeTxHash.toLowerCase() !== hash.toLowerCase())
      throw new Error('Claimed SafeTx hash does not match the transaction')
    if (doc.hashes && String(object(doc.hashes).safeTx).toLowerCase() !== hash.toLowerCase())
      throw new Error('Package SafeTx hash mismatch')
    return tx
  }
  if (!Array.isArray(doc.transactions) || !doc.transactions.length || doc.transactions.length > 100)
    throw new Error('Expected 1-100 Builder transactions or all ten SafeTx fields')
  const calls = doc.transactions.map((raw) => {
    const t = object(raw)
    return {
      to: address(t.to),
      value: uint(t.value ?? '0'),
      data: encodedCall(t),
      operation: operation(t.operation ?? 0),
    }
  })
  const first = calls[0]
  if (calls.length === 1 && first) return completeTx(first, context.nonce)
  if (calls.some((c) => c.operation !== 0))
    throw new Error(
      'Inner delegatecalls are not supported by CALL-only Builder batches. Import a reviewed full SafeTx instead.',
    )
  if (!context.multiSend)
    throw new Error('No code-verified MultiSendCallOnly is available on this chain')
  const data = encodeMultiSend(calls)
  if (size(data) > 256 * 1024) throw new Error('Builder batch calldata is too large')
  return completeTx(
    { to: getAddress(context.multiSend), value: 0n, data, operation: 1 },
    context.nonce,
  )
}

export function signingData(pkg: SafeTxPackage) {
  const tx = parseSafeTx(pkg.tx),
    hashes = safeTxHashes(pkg.chainId, pkg.safe, tx)
  if (
    pkg.hashes.safeTx.toLowerCase() !== hashes.safeTx.toLowerCase() ||
    pkg.hashes.domain.toLowerCase() !== hashes.domain.toLowerCase() ||
    pkg.hashes.message.toLowerCase() !== hashes.message.toLowerCase()
  )
    throw new Error('Package hashes differ from its full transaction')
  const typed = safeTxTypedData(pkg.chainId, pkg.safe, tx)
  return {
    domain: typed.domain,
    types: typed.types,
    primaryType: 'SafeTx',
    message: pkg.tx,
    safeTxHash: hashes.safeTx,
  }
}
export function exportBuilderJson(pkg: SafeTxPackage) {
  signingData(pkg)
  return {
    version: '1.0',
    chainId: String(pkg.chainId),
    createdAt: Date.now(),
    meta: {
      name: 'SafeDesk transaction',
      createdFromSafeAddress: pkg.safe,
      description: `SafeTx ${pkg.hashes.safeTx}; nonce ${pkg.tx.nonce}. Full signing data is authoritative for gas/refund fields.`,
    },
    transactions: [
      {
        to: pkg.tx.to,
        value: pkg.tx.value,
        data: pkg.tx.data,
        operation: pkg.tx.operation,
        contractMethod: null,
        contractInputsValues: null,
      },
    ],
  }
}

export function unsignedEditDraft(pkg: SafeTxPackage) {
  signingData(pkg)
  return {
    chainId: pkg.chainId,
    safe: pkg.safe,
    tx: { ...parseSafeTx(pkg.tx) },
    description: 'Edited transaction (review and sign the new hash)',
    preset: 'raw',
  }
}

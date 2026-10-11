// The Verify page's field form (SPEC §3.10): every SafeTx field as text, parsed strictly.
import { type Address, getAddress, type Hex, isAddress, isHex, zeroAddress } from 'viem'
import { SUPPORTED_PACKAGE_VERSIONS } from '@/core/package'
import type { SafeTx } from '@/core/safe-tx'

export interface FieldValues {
  chainId: string
  safe: string
  version: string
  to: string
  value: string
  data: string
  operation: string
  safeTxGas: string
  baseGas: string
  gasPrice: string
  gasToken: string
  refundReceiver: string
  nonce: string
}

export const emptyFields: FieldValues = {
  chainId: '1',
  safe: '',
  version: '1.4.1',
  to: '',
  value: '0',
  data: '0x',
  operation: '0',
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: '0',
}

export interface Parsed {
  readonly chainId: number
  readonly safe: Address
  readonly version: string
  readonly tx: SafeTx
}

const UINT256_MAX = 2n ** 256n - 1n

function uint(text: string): bigint | undefined {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return undefined
  const n = BigInt(t)
  return n <= UINT256_MAX ? n : undefined
}

const address = (text: string): Address | undefined =>
  isAddress(text.trim(), { strict: false }) ? getAddress(text.trim()) : undefined

/** The parsed transaction, or the problem with each field that doesn't parse. */
export function parseFields(
  f: FieldValues,
): { ok: true; value: Parsed } | { ok: false; errors: Partial<Record<keyof FieldValues, string>> } {
  const errors: Partial<Record<keyof FieldValues, string>> = {}
  const chainId = uint(f.chainId)
  if (chainId === undefined || chainId === 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER))
    errors.chainId = 'A chain ID, such as 1 or 11155111'
  const safe = address(f.safe)
  if (!safe) errors.safe = 'A 0x address'
  if (!SUPPORTED_PACKAGE_VERSIONS.has(f.version)) errors.version = 'v1.3.0 or later'
  const to = address(f.to)
  if (!to) errors.to = 'A 0x address'
  const data = f.data.trim() === '' ? '0x' : f.data.trim()
  if (!isHex(data, { strict: true }) || data.length % 2 !== 0) errors.data = 'Hex bytes, such as 0x'
  if (f.operation !== '0' && f.operation !== '1') errors.operation = '0 (call) or 1 (delegatecall)'
  const nums = {} as Record<'value' | 'safeTxGas' | 'baseGas' | 'gasPrice' | 'nonce', bigint>
  for (const k of ['value', 'safeTxGas', 'baseGas', 'gasPrice', 'nonce'] as const) {
    const n = uint(f[k])
    if (n === undefined) errors[k] = 'A whole number (uint256)'
    else nums[k] = n
  }
  const gasToken = address(f.gasToken)
  if (!gasToken) errors.gasToken = 'A 0x address'
  const refundReceiver = address(f.refundReceiver)
  if (!refundReceiver) errors.refundReceiver = 'A 0x address'
  if (Object.keys(errors).length || !safe || !to || !gasToken || !refundReceiver)
    return { ok: false, errors }
  return {
    ok: true,
    value: {
      chainId: Number(chainId),
      safe,
      version: f.version,
      tx: {
        to,
        value: nums.value,
        data: data.toLowerCase() as Hex,
        operation: f.operation === '1' ? 1 : 0,
        safeTxGas: nums.safeTxGas,
        baseGas: nums.baseGas,
        gasPrice: nums.gasPrice,
        gasToken,
        refundReceiver,
        nonce: nums.nonce,
      },
    },
  }
}

/** Field text for a parsed transaction, to edit a pasted package's fields. */
export function toFields(p: Parsed): FieldValues {
  return {
    chainId: String(p.chainId),
    safe: p.safe,
    version: p.version,
    to: p.tx.to,
    value: p.tx.value.toString(),
    data: p.tx.data,
    operation: String(p.tx.operation),
    safeTxGas: p.tx.safeTxGas.toString(),
    baseGas: p.tx.baseGas.toString(),
    gasPrice: p.tx.gasPrice.toString(),
    gasToken: p.tx.gasToken,
    refundReceiver: p.tx.refundReceiver,
    nonce: p.tx.nonce.toString(),
  }
}

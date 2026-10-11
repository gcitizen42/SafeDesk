// EIP-712 hashing for Safe transactions, v1.3.0+ (SPEC §5.1). Pure functions on viem primitives.
import { type Address, concat, type Hex, hashDomain, hashStruct, keccak256 } from 'viem'

export type Operation = 0 | 1

export interface SafeTx {
  readonly to: Address
  readonly value: bigint
  readonly data: Hex
  readonly operation: Operation
  readonly safeTxGas: bigint
  readonly baseGas: bigint
  readonly gasPrice: bigint
  readonly gasToken: Address
  readonly refundReceiver: Address
  readonly nonce: bigint
}

export interface SafeTxHashes {
  /** The domain separator. */
  readonly domain: Hex
  /** The SafeTx struct hash. */
  readonly message: Hex
  /** keccak256(0x1901 ‖ domain ‖ message): what owners sign. */
  readonly safeTx: Hex
}

/** v1.3.0+ domain: `EIP712Domain(uint256 chainId,address verifyingContract)`. */
const EIP712_DOMAIN_TYPE = [
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const

export const SAFE_TX_TYPE = [
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'data', type: 'bytes' },
  { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' },
  { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' },
  { name: 'gasToken', type: 'address' },
  { name: 'refundReceiver', type: 'address' },
  { name: 'nonce', type: 'uint256' },
] as const

/** The typed data owners sign with `eth_signTypedData_v4`. */
export function safeTxTypedData(chainId: number, safe: Address, tx: SafeTx) {
  return {
    domain: { chainId, verifyingContract: safe },
    types: { SafeTx: SAFE_TX_TYPE },
    primaryType: 'SafeTx' as const,
    message: { ...tx },
  }
}

function domainHash(chainId: number, safe: Address): Hex {
  return hashDomain({
    domain: { chainId: BigInt(chainId), verifyingContract: safe },
    types: { EIP712Domain: EIP712_DOMAIN_TYPE },
  })
}

function messageHash(tx: SafeTx): Hex {
  return hashStruct({ data: { ...tx }, primaryType: 'SafeTx', types: { SafeTx: SAFE_TX_TYPE } })
}

export function safeTxHashes(chainId: number, safe: Address, tx: SafeTx): SafeTxHashes {
  const domain = domainHash(chainId, safe)
  const message = messageHash(tx)
  return { domain, message, safeTx: keccak256(concat(['0x1901', domain, message])) }
}

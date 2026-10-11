// Package format v1 (SPEC §6). Everything in a package is untrusted: it is decoded with this
// schema, its hashes are recomputed, and every signature is recovered.
import { Schema } from 'effect'
import { Address, ChainId, Hex } from './common'

/** Decimal string for a uint256 (no leading zeros, no sign). */
const Uint256String = Schema.String.pipe(
  Schema.pattern(/^(0|[1-9]\d{0,77})$/),
  Schema.filter((s) => BigInt(s) < 2n ** 256n || 'Out of range for uint256'),
)

const Bytes32 = Hex.pipe(Schema.filter((h) => h.length === 66 || 'Expected 32 bytes'))
const Calldata = Hex.pipe(
  Schema.filter((h) => h.length <= 2 + 2 * 256 * 1024 || 'Calldata over 256 KB'),
)

const PackageTx = Schema.Struct({
  to: Address,
  value: Uint256String,
  data: Calldata,
  operation: Schema.Literal(0, 1),
  safeTxGas: Uint256String,
  baseGas: Uint256String,
  gasPrice: Uint256String,
  gasToken: Address,
  refundReceiver: Address,
  nonce: Uint256String,
})

export const PackageSignature = Schema.Struct({
  signer: Address,
  kind: Schema.Literal('eip712'),
  data: Hex.pipe(Schema.filter((h) => h.length === 132 || 'Expected a 65-byte signature')),
})
export type PackageSignature = typeof PackageSignature.Type

export const SafeTxPackage = Schema.Struct({
  type: Schema.Literal('plainsafe/safe-tx'),
  version: Schema.Literal(1),
  chainId: ChainId,
  safe: Address,
  /** Claimed; checked against the code hash onchain. */
  safeVersion: Schema.String.pipe(Schema.maxLength(16)),
  tx: PackageTx,
  /** For humans only; always recomputed, and the package is rejected on mismatch. */
  hashes: Schema.Struct({ domain: Bytes32, message: Bytes32, safeTx: Bytes32 }),
  signatures: Schema.Array(PackageSignature).pipe(Schema.maxItems(100)),
  /** Always shown as "Proposer's note (unverified)". */
  note: Schema.optional(Schema.String.pipe(Schema.maxLength(1000))),
  createdAt: Schema.String.pipe(Schema.maxLength(40)),
})
export type SafeTxPackage = typeof SafeTxPackage.Type

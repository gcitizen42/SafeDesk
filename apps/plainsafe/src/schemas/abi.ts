// A user-supplied ABI (SPEC §9.2: untrusted input is decoded with Schema).
import { Schema } from 'effect'
import { Address, ChainId, Hex } from './common'

export interface AbiParam {
  readonly name?: string | undefined
  readonly type: string
  readonly internalType?: string | undefined
  readonly indexed?: boolean | undefined
  readonly components?: readonly AbiParam[] | undefined
}

const TypeName = Schema.String.pipe(Schema.pattern(/^[a-z0-9]+(\[\d*\])*$|^tuple(\[\d*\])*$/))

export const AbiParam: Schema.Schema<AbiParam> = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  type: TypeName,
  internalType: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  indexed: Schema.optional(Schema.Boolean),
  components: Schema.optional(Schema.Array(Schema.suspend(() => AbiParam))),
})

const Name = Schema.String.pipe(Schema.pattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/))
const Mutability = Schema.Literal('pure', 'view', 'nonpayable', 'payable')

export const AbiItem = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('function'),
    name: Name,
    inputs: Schema.Array(AbiParam),
    outputs: Schema.optionalWith(Schema.Array(AbiParam), { default: () => [] }),
    stateMutability: Schema.optionalWith(Mutability, { default: () => 'nonpayable' as const }),
  }),
  Schema.Struct({
    type: Schema.Literal('event'),
    name: Name,
    inputs: Schema.Array(AbiParam),
    anonymous: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal('error'), name: Name, inputs: Schema.Array(AbiParam) }),
  Schema.Struct({ type: Schema.Literal('constructor', 'fallback', 'receive') }).pipe(
    Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  ),
)

export const Abi = Schema.Array(AbiItem).pipe(Schema.maxItems(2000))
export type Abi = typeof Abi.Type

/** An ABI saved to the library, tied to implementation code, not an address (SPEC §7.3). */
export const AbiRecord = Schema.Struct({
  chainId: ChainId,
  implementation: Address,
  codeHash: Hex,
  label: Schema.String.pipe(Schema.maxLength(100)),
  abi: Abi,
  savedAt: Schema.String.pipe(Schema.maxLength(40)),
})
export type AbiRecord = typeof AbiRecord.Type

export const abiKey = (chainId: number, codeHash: string) => `${chainId}:${codeHash.toLowerCase()}`

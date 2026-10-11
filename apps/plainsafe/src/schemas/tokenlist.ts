// Token lists in the Uniswap Token Lists format (SPEC §10), and what we store of them.
import { Schema } from 'effect'
import { Address, ChainId } from './common'

/** One token, with only the fields Plain Safe uses. logoURI is ignored (SPEC §8.2: no logos). */
export const ListToken = Schema.Struct({
  chainId: ChainId,
  address: Address,
  symbol: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32)),
  name: Schema.String.pipe(Schema.maxLength(64)),
  decimals: Schema.Int.pipe(Schema.between(0, 255)),
})
export type ListToken = typeof ListToken.Type

/** The list envelope; tokens are decoded one by one so one bad token doesn't reject the list. */
export const TokenListEnvelope = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  tokens: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20_000)),
})

export const TokenListRecord = Schema.Struct({
  id: Schema.String.pipe(Schema.maxLength(300)),
  name: Schema.String.pipe(Schema.maxLength(64)),
  /** "built-in", "pasted", "file" or the URL it came from. */
  source: Schema.String.pipe(Schema.maxLength(300)),
  enabled: Schema.Boolean,
  tokens: Schema.Array(ListToken).pipe(Schema.maxItems(20_000)),
  importedAt: Schema.String.pipe(Schema.maxLength(40)),
})
export type TokenListRecord = typeof TokenListRecord.Type

export const MyToken = Schema.Struct({
  ...ListToken.fields,
  addedAt: Schema.String.pipe(Schema.maxLength(40)),
})
export type MyToken = typeof MyToken.Type

export const myTokenKey = (chainId: number, address: string) =>
  `${chainId}:${address.toLowerCase()}`

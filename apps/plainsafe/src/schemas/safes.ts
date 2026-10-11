// Records in the `safes` (My Safes) and `recent` stores, and the address book (SPEC §9.5).
import { Schema } from 'effect'
import { Address, ChainId } from './common'

const Decimal = Schema.String.pipe(Schema.pattern(/^\d{1,78}$/))

export const SafeRecord = Schema.Struct({
  chainId: ChainId,
  address: Address,
  /** Inferred from the singleton's code hash when the Safe was added (SPEC §4.2). */
  version: Schema.String.pipe(Schema.maxLength(16)),
  l2: Schema.Boolean,
  addedAt: Schema.String.pipe(Schema.maxLength(40)),
  /** The last chain state we saw, for the list view. Always re-read before use. */
  lastSeen: Schema.optional(
    Schema.Struct({
      block: Decimal,
      nonce: Decimal,
      threshold: Decimal,
      ownerCount: Schema.Int.pipe(Schema.between(0, 1000)),
    }),
  ),
})
export type SafeRecord = typeof SafeRecord.Type

export const safeKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`

/** Labels come only from here, never from packages (SPEC §6). `*` applies on every chain. */
export const AddressBookEntry = Schema.Struct({
  chainId: Schema.Union(ChainId, Schema.Literal('*')),
  address: Address,
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
})
export type AddressBookEntry = typeof AddressBookEntry.Type

export const addressBookKey = (chainId: number | '*', address: string) =>
  `${chainId}:${address.toLowerCase()}`

/** The label for an address: a chain-specific one first, then one for every chain. */
export const labelFor = (
  entries: readonly AddressBookEntry[],
  chainId: number,
  address: string,
): string | undefined => {
  const a = address.toLowerCase()
  return (
    entries.find((e) => e.chainId === chainId && e.address.toLowerCase() === a)?.label ??
    entries.find((e) => e.chainId === '*' && e.address.toLowerCase() === a)?.label
  )
}

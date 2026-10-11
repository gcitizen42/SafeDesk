// Safe storage layout, v1.3.0+ (SPEC §4.3). Used for simulation state overrides.
import { type Address, encodeAbiParameters, type Hex, keccak256, numberToHex } from 'viem'

export const SLOT = {
  singleton: 0,
  modules: 1,
  owners: 2,
  ownerCount: 3,
  threshold: 4,
  nonce: 5,
  deprecatedDomainSeparator: 6,
  signedMessages: 7,
  approvedHashes: 8,
} as const

export const SENTINEL: Address = '0x0000000000000000000000000000000000000001'

/** A number as a 32-byte word: a storage value, or a slot key. */
export const word = (n: number | bigint): Hex => numberToHex(n, { size: 32 })
export const slot = word

/** Storage slot of `owners[owner]` in the owners linked list (mapping at slot 2). */
export const ownersSlot = (owner: Address): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner, 2n]))

/** The singleton address held in slot 0. */
export const singletonFromSlot0 = (value: Hex): Address => `0x${value.slice(-40)}` as Address

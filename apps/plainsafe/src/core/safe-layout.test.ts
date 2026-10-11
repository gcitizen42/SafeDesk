import { encodeAbiParameters, keccak256 } from 'viem'
import { describe, expect, it } from 'vitest'
import { ownersSlot, SENTINEL, SLOT, singletonFromSlot0, slot } from './safe-layout'

describe('Safe storage layout (SPEC §4.3)', () => {
  it('has the documented slots', () => {
    expect(SLOT).toEqual({
      singleton: 0,
      modules: 1,
      owners: 2,
      ownerCount: 3,
      threshold: 4,
      nonce: 5,
      deprecatedDomainSeparator: 6,
      signedMessages: 7,
      approvedHashes: 8,
    })
    expect(slot(4)).toBe(`0x${'0'.repeat(63)}4`)
  })

  it('derives mapping slots as keccak256(key ‖ slot)', () => {
    expect(ownersSlot(SENTINEL)).toBe(
      keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [SENTINEL, 2n])),
    )
  })

  it('reads the singleton from slot 0', () => {
    expect(
      singletonFromSlot0(`0x000000000000000000000000${'41675c099f32341bf84bfc5382af534df5c7461a'}`),
    ).toBe('0x41675c099f32341bf84bfc5382af534df5c7461a')
  })
})

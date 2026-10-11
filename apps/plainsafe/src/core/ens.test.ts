import { describe, expect, it } from 'vitest'
import { coinTypeFor, ensChainFor } from './ens'

describe('ENS registry and coin type per chain', () => {
  it('uses Mainnet ENS except for Sepolia', () => {
    expect(ensChainFor(1)).toBe(1)
    expect(ensChainFor(8453)).toBe(1)
    expect(ensChainFor(11155111)).toBe(11155111)
  })
  it('uses coin type 60 on the registry chain and ENSIP-11 coin types elsewhere', () => {
    expect(coinTypeFor(1)).toBe(60n)
    expect(coinTypeFor(11155111)).toBe(60n)
    expect(coinTypeFor(8453)).toBe(BigInt(0x80000000 + 8453))
    expect(coinTypeFor(10)).toBe(BigInt(0x80000000 + 10))
  })
})

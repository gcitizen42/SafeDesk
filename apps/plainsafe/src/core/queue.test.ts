import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { classifyQueue, isHistory } from './queue'

const A: Address = '0x1111111111111111111111111111111111111111'
const B: Address = '0x2222222222222222222222222222222222222222'
const X: Address = '0x9999999999999999999999999999999999999999'
const h = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex
const chain = { nonce: 5n, threshold: 2n, owners: [A, B] }

describe('classifyQueue (SPEC §3.9)', () => {
  it('classifies every state', () => {
    const items = [
      { safeTxHash: h(1), nonce: 5n, signers: [A] }, // needs signatures
      { safeTxHash: h(2), nonce: 6n, signers: [A, B] }, // future
      { safeTxHash: h(3), nonce: 7n, signers: [] }, // conflict with h(4)
      { safeTxHash: h(4), nonce: 7n, signers: [A] },
      { safeTxHash: h(5), nonce: 3n, signers: [A, B], execution: { status: 'executed' as const } },
      { safeTxHash: h(6), nonce: 4n, signers: [A] }, // nonce used
      { safeTxHash: h(7), nonce: 2n, signers: [A, B], execution: { status: 'failed' as const } },
    ]
    const out = classifyQueue(items, chain)
    const state = (n: number) => out.find((o) => o.item.safeTxHash === h(n))?.state
    expect([1, 2, 3, 4, 5, 6, 7].map(state)).toEqual([
      'needs-signatures',
      'future',
      'conflict',
      'conflict',
      'executed',
      'nonce-used',
      'failed',
    ])
    expect(out.map((o) => o.item.nonce)).toEqual([2n, 3n, 4n, 5n, 6n, 7n, 7n])
  })

  it('is ready at the current nonce with threshold signatures from current owners only', () => {
    expect(classifyQueue([{ safeTxHash: h(1), nonce: 5n, signers: [A, B] }], chain)[0]?.state).toBe(
      'ready',
    )
    const withNonOwner = classifyQueue([{ safeTxHash: h(1), nonce: 5n, signers: [A, X] }], chain)[0]
    expect(withNonOwner?.state).toBe('needs-signatures')
    expect(withNonOwner?.validSignatures).toBe(1)
  })

  it('an executed package does not conflict with its replacement', () => {
    const out = classifyQueue(
      [
        {
          safeTxHash: h(1),
          nonce: 5n,
          signers: [A, B],
          execution: { status: 'executed' as const },
        },
        { safeTxHash: h(2), nonce: 5n, signers: [A] },
      ],
      { ...chain, nonce: 6n },
    )
    expect(out.map((o) => o.state)).toEqual(['executed', 'nonce-used'])
    expect(out.map((o) => isHistory(o.state))).toEqual([true, true])
  })
})

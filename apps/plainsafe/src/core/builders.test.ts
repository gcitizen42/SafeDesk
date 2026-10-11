import { type Address, decodeFunctionData, erc20Abi, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  applyOwnerChange,
  cancelTx,
  completeTx,
  isCancel,
  nextNonce,
  ownerChangeCall,
  ownerChangeProblem,
  prevOwner,
  sendErc20,
  sendNative,
} from './builders'
import { decodeCalldata } from './decode'
import { describeCall } from './describe'
import { safeManagementAbi } from './known-abis'
import { SENTINEL } from './safe-layout'
import { safetyBanners } from './safety-rules'

const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const A: Address = '0x1111111111111111111111111111111111111111'
const B: Address = '0x2222222222222222222222222222222222222222'
const C: Address = '0x3333333333333333333333333333333333333333'
const D: Address = '0x4444444444444444444444444444444444444444'
const owners = [A, B, C]

describe('builder presets', () => {
  it('sends native currency as a plain call with empty data', () => {
    expect(completeTx(sendNative(B, 5n), 7n)).toEqual({
      to: B,
      value: 5n,
      data: '0x',
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: 7n,
    })
  })

  it('encodes an ERC-20 transfer to the token', () => {
    const call = sendErc20(C, B, 1000n)
    expect(call.to).toBe(C)
    expect(call.value).toBe(0n)
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({
      functionName: 'transfer',
      args: [B, 1000n],
    })
  })

  it('picks the next free nonce', () => {
    expect(nextNonce(5n, [])).toBe(5n)
    expect(nextNonce(5n, [5n, 6n])).toBe(7n)
    expect(nextNonce(5n, [2n])).toBe(5n)
  })
})

describe('owner management', () => {
  it('finds prevOwner from the getOwners() order', () => {
    expect(prevOwner(owners, A)).toBe(SENTINEL)
    expect(prevOwner(owners, C)).toBe(B)
    expect(() => prevOwner(owners, D)).toThrow()
  })

  it('targets the Safe itself with operation 0', () => {
    const call = ownerChangeCall(safe, owners, { kind: 'remove', owner: B, threshold: 1n })
    expect(call).toMatchObject({ to: safe, value: 0n, operation: 0 })
    expect(decodeFunctionData({ abi: safeManagementAbi, data: call.data })).toEqual({
      functionName: 'removeOwner',
      args: [A, B, 1n],
    })
    const swap = ownerChangeCall(safe, owners, { kind: 'swap', oldOwner: A, newOwner: D })
    expect(decodeFunctionData({ abi: safeManagementAbi, data: swap.data }).args).toEqual([
      SENTINEL,
      A,
      D,
    ])
  })

  it('computes the after state for the before → after view', () => {
    expect(applyOwnerChange(owners, 2n, { kind: 'add', owner: D, threshold: 3n })).toEqual({
      owners: [D, A, B, C],
      threshold: 3n,
    })
    expect(applyOwnerChange(owners, 2n, { kind: 'swap', oldOwner: B, newOwner: D })).toEqual({
      owners: [A, D, C],
      threshold: 2n,
    })
  })

  it('rejects changes the Safe would reject', () => {
    expect(ownerChangeProblem(safe, owners, 2n, { kind: 'add', owner: A, threshold: 2n })).toMatch(
      /already/,
    )
    expect(
      ownerChangeProblem(safe, owners, 2n, { kind: 'add', owner: safe, threshold: 2n }),
    ).toMatch(/cannot/)
    expect(
      ownerChangeProblem(safe, owners, 2n, { kind: 'add', owner: SENTINEL, threshold: 2n }),
    ).toMatch(/cannot/)
    expect(
      ownerChangeProblem(safe, owners, 2n, { kind: 'remove', owner: B, threshold: 3n }),
    ).toMatch(/more than/)
    expect(ownerChangeProblem(safe, owners, 2n, { kind: 'threshold', threshold: 0n })).toMatch(
      /at least 1/,
    )
    expect(ownerChangeProblem(safe, [A], 1n, { kind: 'remove', owner: A, threshold: 1n })).toMatch(
      /at least one/,
    )
    expect(
      ownerChangeProblem(safe, owners, 2n, { kind: 'swap', oldOwner: D, newOwner: C }),
    ).toMatch(/Not an owner/)
    expect(
      ownerChangeProblem(safe, owners, 2n, { kind: 'add', owner: D, threshold: 3n }),
    ).toBeUndefined()
  })
})

describe('cancel (P1)', () => {
  const safe = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1' as const
  it('is a 0-value, empty call from the Safe to itself at the same nonce', () => {
    const tx = cancelTx(safe, 7n)
    expect(tx).toMatchObject({ to: safe, value: 0n, data: '0x', operation: 0, nonce: 7n })
    expect(isCancel(safe, tx)).toBe(true)
    expect(isCancel(safe, { ...tx, value: 1n })).toBe(false)
    expect(
      describeCall(tx, decodeCalldata(tx.data, []), safe, { symbol: 'ETH', decimals: 18 }),
    ).toBe('Cancel: an empty call that uses up nonce 7')
  })

  it('raises no safety banners at the current nonce', () => {
    const tx = cancelTx(safe, 7n)
    expect(
      safetyBanners({
        safe,
        tx,
        decoded: decodeCalldata(tx.data, []),
        safeVerified: true,
        onchainNonce: 7n,
        targetIsVerifiedMultiSend: false,
      }),
    ).toEqual([])
  })
})

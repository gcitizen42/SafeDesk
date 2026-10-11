import { encodeFunctionData, erc20Abi, type Hex, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { type BatchCall, decodeMultiSend, encodeMultiSend, multiSendAbi } from './multisend'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const R = '0x255C3912f91eF11bFDadd405F13144a823Da8cc5'
const calls: BatchCall[] = [
  { operation: 0, to: R, value: 10n ** 16n, data: '0x' },
  {
    operation: 0,
    to: USDC,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [R, 5n] }),
  },
]

describe('MultiSend encoding', () => {
  it('round-trips a batch', () => {
    expect(decodeMultiSend(encodeMultiSend(calls))).toEqual(calls)
  })

  it('matches the packed layout from the MultiSend contract', () => {
    const data = encodeMultiSend([{ operation: 0, to: zeroAddress, value: 1n, data: '0xab' }])
    // selector, offset, length 86, then 00 ‖ 20-byte address ‖ value 1 ‖ length 1 ‖ ab
    expect(data.slice(0, 10)).toBe('0x8d80ff0a')
    expect(data).toContain(`00${'0'.repeat(40)}${'1'.padStart(64, '0')}${'1'.padStart(64, '0')}ab`)
  })

  it('rejects anything that is not exactly a batch', () => {
    const packed = (d: Hex) =>
      encodeFunctionData({ abi: multiSendAbi, functionName: 'multiSend', args: [d] })
    expect(decodeMultiSend('0xdeadbeef')).toBeUndefined()
    expect(decodeMultiSend(packed('0x'))).toBeUndefined()
    // operation 2 is not a thing
    expect(decodeMultiSend(packed(`0x02${'00'.repeat(84)}`))).toBeUndefined()
    // a length that runs past the end
    expect(decodeMultiSend(packed(`0x00${'00'.repeat(52)}${'ff'.repeat(32)}`))).toBeUndefined()
    // trailing bytes that aren't a full entry
    const entry = `00${R.slice(2).toLowerCase()}${'0'.padStart(64, '0')}${'0'.padStart(64, '0')}`
    expect(decodeMultiSend(packed(`0x${entry}`))).toHaveLength(1)
    expect(decodeMultiSend(packed(`0x${entry}00`))).toBeUndefined()
  })
})

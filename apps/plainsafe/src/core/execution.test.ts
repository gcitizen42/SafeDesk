import {
  type Address,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  type Hex,
  parseAbi,
  slice,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { executionOutcome, isRevert, planExecution, revertData, translateRevert } from './execution'
import { prevalidatedSignature } from './signatures'

const A: Address = '0x1111111111111111111111111111111111111111'
const B: Address = '0x2222222222222222222222222222222222222222'
const C: Address = '0x3333333333333333333333333333333333333333'
const X: Address = '0x9999999999999999999999999999999999999999'
const sig = (n: string) => `0x${n.repeat(130)}` as Hex
const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const hash = `0x${'ab'.repeat(32)}` as Hex

describe('planExecution', () => {
  const owners = [A, B, C]
  it('is ready with enough owner signatures, sorted ascending, ignoring non-owners', () => {
    const p = planExecution({
      signatures: [
        { signer: B, data: sig('b') },
        { signer: X, data: sig('9') },
        { signer: A, data: sig('a') },
      ],
      owners,
      threshold: 2n,
    })
    expect(p).toEqual({ kind: 'ready', signatures: `0x${'a'.repeat(130)}${'b'.repeat(130)}` })
  })

  it('counts onchain approvals (approveHash) as pre-validated signatures', () => {
    const p = planExecution({
      signatures: [{ signer: B, data: sig('b') }],
      owners,
      threshold: 2n,
      // B also approved onchain (counted once); X isn't an owner
      approvedBy: [C, B, X],
    })
    expect(p).toEqual({
      kind: 'ready',
      signatures: `0x${'b'.repeat(130)}${prevalidatedSignature(C).slice(2)}`,
    })
  })

  it('adds a pre-validated signature for an owner-executor when exactly one is missing', () => {
    const p = planExecution({
      signatures: [{ signer: B, data: sig('b') }],
      owners,
      threshold: 2n,
      executor: A,
    })
    expect(p).toEqual({
      kind: 'ready',
      signatures: `${prevalidatedSignature(A)}${'b'.repeat(130)}`,
      prevalidatedFor: A,
    })
  })

  it('does not for a non-owner, an owner who already signed, or two missing', () => {
    expect(
      planExecution({
        signatures: [{ signer: B, data: sig('b') }],
        owners,
        threshold: 2n,
        executor: X,
      }),
    ).toEqual({ kind: 'missing', missing: 1 })
    expect(
      planExecution({
        signatures: [{ signer: B, data: sig('b') }],
        owners,
        threshold: 2n,
        executor: B,
      }),
    ).toEqual({ kind: 'missing', missing: 1 })
    expect(planExecution({ signatures: [], owners, threshold: 2n, executor: A })).toEqual({
      kind: 'missing',
      missing: 2,
    })
  })
})

describe('executionOutcome', () => {
  const v141 = parseAbi([
    'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
    'event ExecutionFailure(bytes32 indexed txHash, uint256 payment)',
  ])
  const v130 = parseAbi(['event ExecutionSuccess(bytes32 txHash, uint256 payment)'])
  const log = (topics: Hex[], data: Hex) => ({ address: safe, topics, data }) as never

  it('reads txHash from topics[1] on v1.4.1+ and from data on v1.3.0', () => {
    const t141 = encodeEventTopics({
      abi: v141,
      eventName: 'ExecutionFailure',
      args: { txHash: hash },
    }) as Hex[]
    expect(
      executionOutcome([log(t141, encodeAbiParameters([{ type: 'uint256' }], [0n]))], safe, hash),
    ).toBe('failed')
    const t130 = encodeEventTopics({ abi: v130, eventName: 'ExecutionSuccess' }) as Hex[]
    expect(
      executionOutcome(
        [log(t130, encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [hash, 0n]))],
        safe,
        hash,
      ),
    ).toBe('executed')
    expect(
      executionOutcome(
        [
          log(
            t130,
            encodeAbiParameters(
              [{ type: 'bytes32' }, { type: 'uint256' }],
              [`0x${'cd'.repeat(32)}`, 0n],
            ),
          ),
        ],
        safe,
        hash,
      ),
    ).toBeUndefined()
  })
})

describe('translateRevert (SPEC §3.8)', () => {
  const errorString = (s: string) =>
    encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: [s] })
  it('translates GS codes', () => {
    expect(translateRevert(errorString('GS026'))).toMatch(/^GS026: Invalid owner provided/)
    expect(translateRevert(errorString('GS013'))).toMatch(/^GS013: The Safe transaction failed/)
  })
  it('passes through the inner call error on v1.5.0: Error(string), Panic, custom errors', () => {
    expect(translateRevert(errorString('ERC20: transfer amount exceeds balance'))).toBe(
      'The call reverted: “ERC20: transfer amount exceeds balance”.',
    )
    const panic = encodeErrorResult({
      abi: parseAbi(['error Panic(uint256)']),
      errorName: 'Panic',
      args: [0x11n],
    })
    expect(translateRevert(panic)).toBe('The call panicked: arithmetic overflow or underflow.')
    const abi = parseAbi(['error InsufficientBalance(uint256 available, uint256 required)'])
    const custom = encodeErrorResult({ abi, errorName: 'InsufficientBalance', args: [1n, 2n] })
    expect(translateRevert(custom, abi)).toBe('The call reverted with InsufficientBalance(1, 2).')
    expect(translateRevert(custom)).toMatch(/unknown error data 0x/)
    expect(translateRevert('0x')).toMatch(/without a reason/)
  })
  it('finds revert data in a nested error', () => {
    const data = errorString('GS026')
    expect(revertData({ cause: { cause: { data } } })).toBe(data)
    expect(revertData(new Error(`execution reverted ${data}`))).toBe(data)
    expect(slice(data, 0, 4)).toBe('0x08c379a0')
  })
  it('tells a revert from an RPC failure', () => {
    expect(isRevert({ cause: { data: errorString('GS026') } })).toBe(true)
    expect(isRevert(new Error('execution reverted'))).toBe(true)
    expect(isRevert(new Error('HTTP request failed'))).toBe(false)
  })
})

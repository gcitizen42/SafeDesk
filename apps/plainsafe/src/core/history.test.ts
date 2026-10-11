import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { execTransactionData } from './execution'
import {
  classifyLogError,
  completeness,
  decodeSafeLog,
  largerChunk,
  MAX_CHUNK,
  safeEventsV130,
  safeEventsV141,
  smallerChunk,
  txFromCalldata,
  txFromL2Event,
} from './history'
import { type SafeTx, safeTxHashes } from './safe-tx'

const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const HASH: Hex = `0x${'ab'.repeat(32)}`
const tx: SafeTx = {
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 5n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 12n,
}

describe('decoding Safe logs (SPEC §11)', () => {
  it('reads v1.3.0 (unindexed) and v1.4.1+ (indexed) ExecutionSuccess', () => {
    const v130 = {
      topics: encodeEventTopics({ abi: safeEventsV130, eventName: 'ExecutionSuccess' }) as Hex[],
      data: encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [HASH, 0n]),
    }
    const v141 = {
      topics: encodeEventTopics({
        abi: safeEventsV141,
        eventName: 'ExecutionSuccess',
        args: { txHash: HASH },
      }) as Hex[],
      data: encodeAbiParameters([{ type: 'uint256' }], [7n]),
    }
    expect(decodeSafeLog(v130, '1.3.0')).toEqual({
      name: 'ExecutionSuccess',
      args: { txHash: HASH, payment: '0' },
    })
    expect(decodeSafeLog(v141, '1.4.1')).toEqual({
      name: 'ExecutionSuccess',
      args: { txHash: HASH, payment: '7' },
    })
    expect(decodeSafeLog({ topics: [HASH], data: '0x' }, '1.4.1')).toBeUndefined()
  })

  it("reads SafeMigration's ChangedMasterCopy, logged in the Safe's context", () => {
    // The upgrade of 0xeE9e…252E to v1.4.1 on Mainnet, block 25,040,676
    const log = {
      topics: ['0x75e41bc35ff1bf14d81d1d2f649c0084a0f974f9289c803ec9898eeec4c8d0b8'] as Hex[],
      data: '0x00000000000000000000000041675c099f32341bf84bfc5382af534df5c7461a' as Hex,
    }
    expect(decodeSafeLog(log, '1.4.1')).toEqual({
      name: 'ChangedMasterCopy',
      args: { singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a' },
    })
  })

  it('keeps arrays and bigints JSON-safe', () => {
    const owners: Address[] = [SAFE, tx.to]
    const log = {
      topics: encodeEventTopics({
        abi: safeEventsV141,
        eventName: 'SafeSetup',
        args: { initiator: SAFE },
      }) as Hex[],
      data: encodeAbiParameters(
        [{ type: 'address[]' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
        [owners, 2n, zeroAddress, zeroAddress],
      ),
    }
    expect(decodeSafeLog(log, '1.4.1')?.args).toMatchObject({ owners, threshold: '2' })
  })
})

describe('scanning', () => {
  it('classifies eth_getLogs failures', () => {
    expect(classifyLogError({ message: 'query exceeds max block range 10000' })).toBe('range')
    expect(classifyLogError({ message: 'Log response size exceeded' })).toBe('range')
    expect(classifyLogError({ message: 'query returned more than 10000 results' })).toBe('range')
    expect(classifyLogError({ message: '4444 pruned history unavailable' })).toBe('refused')
    expect(classifyLogError({ code: -32601, message: 'x' })).toBe('refused')
    expect(classifyLogError({ status: 429, message: 'Too many requests' })).toBe('temporary')
    expect(classifyLogError({ message: 'The request took too long to respond' })).toBe('temporary')
  })

  it('halves on range errors down to 1, and doubles on success up to 1M', () => {
    expect(smallerChunk(100_000n)).toBe(50_000n)
    expect(smallerChunk(1n)).toBe(0n)
    expect(largerChunk(100_000n)).toBe(200_000n)
    expect(largerChunk(800_000n)).toBe(MAX_CHUNK)
  })

  it('is complete only with the creation found and one execution per nonce', () => {
    expect(
      completeness({ setupFound: true, executions: 3, onchainNonce: 3n, floorReached: false }),
    ).toEqual({ kind: 'complete' })
    expect(
      completeness({ setupFound: true, executions: 2, onchainNonce: 3n, floorReached: false }).kind,
    ).toBe('incomplete')
    expect(
      completeness({ setupFound: false, executions: 3, onchainNonce: 3n, floorReached: true }).kind,
    ).toBe('incomplete')
  })
})

describe('recovering executed transactions', () => {
  it('reads every parameter from an L2 SafeMultiSigTransaction event', () => {
    const args = {
      to: tx.to,
      value: '5',
      data: '0x',
      operation: 0,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      signatures: '0x1234',
      additionalInfo: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }],
        [12n, SAFE, 2n],
      ),
    }
    expect(txFromL2Event(args)).toEqual({ tx, signatures: '0x1234' })
  })

  it('decodes L1 execTransaction calldata and finds the nonce by checking the safeTxHash', () => {
    const safeTxHash = safeTxHashes(1, SAFE, tx).safeTx
    const input = execTransactionData(tx, '0x1234')
    expect(
      txFromCalldata({ input, to: SAFE, chainId: 1, safe: SAFE, safeTxHash, nonceGuess: 11n }),
    ).toEqual({ tx, signatures: '0x1234' })
    // Wrong Safe, or a hash that no nearby nonce matches
    expect(
      txFromCalldata({ input, to: tx.to, chainId: 1, safe: SAFE, safeTxHash, nonceGuess: 12n }),
    ).toBeUndefined()
    expect(
      txFromCalldata({
        input,
        to: SAFE,
        chainId: 1,
        safe: SAFE,
        safeTxHash: HASH,
        nonceGuess: 12n,
      }),
    ).toBeUndefined()
  })
})

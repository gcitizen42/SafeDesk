import { decodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  exportBuilderJson,
  importBuilderJson,
  parseSafeTx,
  signingData,
  unsignedEditDraft,
} from './builder-json'
import { decodeMultiSend } from './multisend'
import { makePackage } from './package'
import { safeTxHashes } from './safe-tx'

const safe = '0x1111111111111111111111111111111111111111' as const,
  helper = '0x2222222222222222222222222222222222222222' as const
const tx = {
  to: safe,
  value: 0n,
  data: '0x1234',
  operation: 1,
  safeTxGas: 4n,
  baseGas: 5n,
  gasPrice: 6n,
  gasToken: safe,
  refundReceiver: helper,
  nonce: 9n,
} as const
const context = { chainId: 1, safe, nonce: 9n, multiSend: helper }
const pkg = () => makePackage({ chainId: 1, safe, safeVersion: '1.3.0', tx })
describe('SafeDesk Builder JSON and editing', () => {
  it('preserves all ten SafeTx fields, especially operation, nonce and refunds', () => {
    const data = signingData(pkg())
    expect(importBuilderJson(data, context)).toEqual(tx)
    expect(signingData(pkg()).safeTxHash).toBe(safeTxHashes(1, safe, tx).safeTx)
    expect(exportBuilderJson(pkg()).transactions[0]?.operation).toBe(1)
    const draft = unsignedEditDraft(pkg())
    expect(draft.tx).toEqual(tx)
    expect(draft).not.toHaveProperty('signatures')
    draft.tx.value = 1n
    expect(pkg().tx.value).toBe('0')
    expect(safeTxHashes(1, safe, draft.tx).safeTx).not.toBe(pkg().hashes.safeTx)
  })
  it('checks chain/Safe/hash and strict numeric/calldata limits', () => {
    expect(() =>
      importBuilderJson(
        { ...signingData(pkg()), domain: { chainId: 10, verifyingContract: safe } },
        context,
      ),
    ).toThrow('chain')
    expect(() =>
      importBuilderJson(
        { ...signingData(pkg()), domain: { chainId: 1, verifyingContract: helper } },
        context,
      ),
    ).toThrow('Safe')
    expect(() =>
      importBuilderJson({ ...signingData(pkg()), safeTxHash: `0x${'00'.repeat(32)}` }, context),
    ).toThrow('hash')
    for (const value of ['-1', '1.2', true, Number.MAX_SAFE_INTEGER + 1, '9'.repeat(79)])
      expect(() => parseSafeTx({ ...pkg().tx, value })).toThrow()
    expect(() => parseSafeTx({ ...pkg().tx, data: '0x123' })).toThrow()
    expect(() => parseSafeTx({ ...pkg().tx, operation: 2 })).toThrow()
  })
  it('imports ABI-method Builder exports and creates exact CALL-only MultiSend batches', () => {
    const doc = {
      chainId: '1',
      meta: { createdFromSafeAddress: safe },
      transactions: [
        {
          to: helper,
          value: '0',
          data: null,
          contractMethod: {
            name: 'transfer',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
          },
          contractInputsValues: { to: safe, amount: '12' },
        },
        { to: safe, value: '5', data: '0x' },
      ],
    }
    const result = importBuilderJson(doc, context),
      calls = decodeMultiSend(result.data)
    expect(result.to).toBe(helper)
    expect(result.operation).toBe(1)
    expect(result.value).toBe(0n)
    expect(calls?.length).toBe(2)
    expect(calls?.[1]?.value).toBe(5n)
    const first = calls?.[0]
    if (!first) throw new Error('Missing first batched call')
    expect(
      decodeFunctionData({
        abi: parseAbi(['function transfer(address to,uint256 amount)']),
        data: first.data,
      }).args,
    ).toEqual([safe, 12n])
    expect(() => importBuilderJson(doc, { ...context, multiSend: undefined })).toThrow('MultiSend')
    expect(() =>
      importBuilderJson(
        { ...doc, transactions: doc.transactions.map((t) => ({ ...t, operation: 1 })) },
        context,
      ),
    ).toThrow('Inner delegatecalls')
  })
  it('refuses unsupported ABI widths, malformed methods and excessive batch counts', () => {
    const bad = {
      transactions: [
        {
          to: safe,
          data: null,
          contractMethod: { name: 'x', inputs: [{ name: 'amount', type: 'uint10000000' }] },
          contractInputsValues: { amount: '1' },
        },
      ],
    }
    expect(() => importBuilderJson(bad, context)).toThrow('type')
    expect(() =>
      importBuilderJson({ transactions: Array(101).fill({ to: safe, data: '0x' }) }, context),
    ).toThrow('1-100')
  })
})

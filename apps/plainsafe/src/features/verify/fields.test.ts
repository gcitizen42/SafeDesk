import { describe, expect, it } from 'vitest'
import { safeTxHashes } from '@/core/safe-tx'
import { emptyFields, parseFields, toFields } from './fields'

// safe-tx-hashes-util's Arbitrum addOwnerWithThreshold vector (also in src/core/safe-tx.test.ts)
const vector = {
  ...emptyFields,
  chainId: '42161',
  safe: '0x111CEEee040739fD91D29C34C33E6B3E112F2177',
  version: '1.3.0',
  to: '0x111CEEee040739fD91D29C34C33E6B3E112F2177',
  data: '0x0d582f130000000000000000000000000c75fa5a5f1c0997e3eea425cfa13184ed0ec9e50000000000000000000000000000000000000000000000000000000000000003',
  nonce: '234',
}

describe('Verify fields (SPEC §3.10)', () => {
  it('parses every field and round-trips through toFields', () => {
    const r = parseFields(vector)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.tx.nonce).toBe(234n)
    expect(parseFields(toFields(r.value))).toEqual(r)
    expect(safeTxHashes(r.value.chainId, r.value.safe, r.value.tx).safeTx).toBe(
      '0x0cb7250b8becd7069223c54e2839feaed4cee156363fbfe5dd0a48e75c4e25b3',
    )
  })

  it('reports each bad field', () => {
    const r = parseFields({
      ...vector,
      chainId: '0',
      safe: '0x1234',
      version: '1.2.0',
      data: '0xabc',
      operation: '2',
      value: '-1',
      nonce: (2n ** 256n).toString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errors).sort()).toEqual(
      ['chainId', 'data', 'nonce', 'operation', 'safe', 'value', 'version'].sort(),
    )
  })

  it('treats empty data as 0x and accepts lowercase addresses', () => {
    const r = parseFields({ ...vector, data: '', to: vector.safe.toLowerCase() })
    expect(r.ok && r.value.tx.data).toBe('0x')
    expect(r.ok && r.value.tx.to).toBe(vector.safe)
  })
})

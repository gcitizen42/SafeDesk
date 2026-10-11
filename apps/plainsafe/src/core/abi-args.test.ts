import { describe, expect, it } from 'vitest'
import { ArgError, parseArg } from './abi-args'

describe('parseArg', () => {
  it('parses scalars', () => {
    expect(parseArg({ type: 'address' }, '0x4f2083f5fbede34c2714affb3105539775f7fe64')).toBe(
      '0x4F2083f5fBede34C2714aFfb3105539775f7FE64',
    )
    expect(parseArg({ type: 'uint256' }, ' 1000 ')).toBe(1000n)
    expect(parseArg({ type: 'uint8' }, '0xff')).toBe(255n)
    expect(parseArg({ type: 'int8' }, '-128')).toBe(-128n)
    expect(parseArg({ type: 'bool' }, 'true')).toBe(true)
    expect(parseArg({ type: 'bytes4' }, '0xa9059cbb')).toBe('0xa9059cbb')
    expect(parseArg({ type: 'bytes' }, '0x')).toBe('0x')
    expect(parseArg({ type: 'string' }, ' hi ')).toBe(' hi ')
  })

  it('rejects bad scalars with a message naming the field', () => {
    expect(() => parseArg({ name: 'to', type: 'address' }, '0x123')).toThrow(
      /to: not a valid address/,
    )
    expect(() => parseArg({ type: 'uint8' }, '256')).toThrow(ArgError)
    expect(() => parseArg({ type: 'uint256' }, '-1')).toThrow(/out of range/)
    expect(() => parseArg({ type: 'uint256' }, '1.5')).toThrow(/whole number/)
    // a blank field is not 0
    expect(() => parseArg({ type: 'uint256' }, ' ')).toThrow(/whole number/)
    expect(() => parseArg({ type: 'bytes4' }, '0xa9059c')).toThrow(/exactly 4 bytes/)
    expect(() => parseArg({ type: 'bool' }, 'yes')).toThrow()
    // mixed case with a bad checksum is rejected
    expect(() =>
      parseArg({ type: 'address' }, '0x4F2083f5fBede34C2714aFfb3105539775f7fE64'),
    ).toThrow()
  })

  it('parses arrays and tuples from JSON', () => {
    expect(parseArg({ type: 'uint256[]' }, '["1", 2]')).toEqual([1n, 2n])
    expect(() => parseArg({ type: 'uint256[2]' }, '[1]')).toThrow(/expected 2 items/)
    expect(() => parseArg({ type: 'uint256[]' }, '[true]')).toThrow(/whole number/)
    // JSON numbers past 2^53 lose precision, so they must be quoted
    expect(() => parseArg({ type: 'uint256[]' }, '[123456789012345678901]')).toThrow(/in quotes/)
    expect(parseArg({ type: 'uint256[]' }, '["123456789012345678901"]')).toEqual([
      123456789012345678901n,
    ])
    const tuple = {
      type: 'tuple',
      components: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
    }
    expect(
      parseArg(tuple, '{"to":"0x0000000000000000000000000000000000000001","amount":"5"}'),
    ).toEqual({
      to: '0x0000000000000000000000000000000000000001',
      amount: 5n,
    })
    expect(
      parseArg(
        { ...tuple, type: 'tuple[]' },
        '[["0x0000000000000000000000000000000000000001", 5]]',
      ),
    ).toEqual([['0x0000000000000000000000000000000000000001', 5n]])
    expect(() => parseArg({ type: 'uint256[]' }, 'nope')).toThrow(/valid JSON/)
  })
})

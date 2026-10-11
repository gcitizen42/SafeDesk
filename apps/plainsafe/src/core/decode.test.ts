import { encodeFunctionData, parseAbi, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { decodeCalldata, guessCall } from './decode'
import { ensAbi } from './known-abis'

describe('signature-database guesses (level 4)', () => {
  const data = encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 amount)']),
    functionName: 'transfer',
    args: ['0x255C3912f91eF11bFDadd405F13144a823Da8cc5', 5n],
  })

  it('uses the first registered signature that decodes, and lists the others', () => {
    const g = guessCall(data, [
      'transfer(address,uint256)',
      'bogus(uint8)',
      'transfer(bytes20,uint256)',
    ])
    expect(g?.signature).toBe('transfer(address,uint256)')
    expect(g?.args.map((a) => a.value)).toEqual(['0x255C3912f91eF11bFDadd405F13144a823Da8cc5', 5n])
    // bogus(uint8) has another selector; transfer(bytes20,…) has another selector too
    expect(g?.alternatives).toEqual([])
  })

  it('returns nothing when no signature decodes', () => {
    expect(guessCall(data, ['approve(address,uint256)', 'not a signature'])).toBeUndefined()
    expect(guessCall('0x1234', ['transfer(address,uint256)'])).toBeUndefined()
  })
})

describe('calls inside multicall(bytes[]) (SPEC §7.1)', () => {
  const node = `0x${'54'.repeat(32)}` as const
  const target = '0x3AF5CFc7C7f29Da9d7758339b8eaB6a78550Cbed'
  const setAddr = (coinType: bigint) =>
    encodeFunctionData({
      abi: ensAbi,
      functionName: 'setAddr',
      args: [node, coinType, target.toLowerCase() as `0x${string}`],
    })
  const multicall = (calls: `0x${string}`[]) =>
    encodeFunctionData({ abi: ensAbi, functionName: 'multicall', args: [calls] })
  const ens = [{ source: 'ENS', abi: ensAbi }]

  it('decodes each call against the same contract, with the same bytecode check', () => {
    const data = multicall([setAddr(60n), setAddr(2147483648n)])
    const d = decodeCalldata(data, ens)
    expect(
      d.kind === 'abi' && d.inner?.map((c) => c.decoded.kind === 'abi' && c.decoded.functionName),
    ).toEqual(['setAddr', 'setAddr'])
    // A call whose selector isn't in the contract's code stays undecoded
    const only = new Set([toFunctionSelector('multicall(bytes[])')])
    const filtered = decodeCalldata(data, ens, only)
    expect(filtered.kind === 'abi' && filtered.inner?.map((c) => c.decoded.kind)).toEqual([
      'raw',
      'raw',
    ])
  })

  it('goes one multicall deep inside another, and no further', () => {
    const nested = multicall([multicall([multicall([setAddr(60n)])])])
    const d = decodeCalldata(nested, ens)
    const inner = d.kind === 'abi' ? d.inner?.[0]?.decoded : undefined
    expect(inner?.kind === 'abi' && inner.inner?.[0]?.decoded.kind).toBe('abi')
    const deepest = inner?.kind === 'abi' ? inner.inner?.[0]?.decoded : undefined
    expect(deepest?.kind === 'abi' && deepest.inner).toBeUndefined()
  })
})

import { Either } from 'effect'
import { describe, expect, it } from 'vitest'
import defaults from '@/generated/default-tokenlist.json'
import { fiatPerEth, valueInWei } from './prices'
import { duplicateSymbols, exportTokenList, parseTokenList, tokenListSource } from './tokenlist'

const token = {
  chainId: 1,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const,
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoURI: 'https://x/y.png',
}

describe('token lists', () => {
  it('accepts a valid list and ignores logoURI', () => {
    const r = parseTokenList({
      name: 'L',
      timestamp: '2026-01-01',
      version: { major: 1, minor: 0, patch: 0 },
      tokens: [token],
    })
    expect(Either.isRight(r) && r.right).toEqual({
      name: 'L',
      tokens: [
        { chainId: 1, address: token.address, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
      ],
      skipped: 0,
    })
  })

  it('skips malformed tokens one at a time and de-duplicates', () => {
    const r = parseTokenList({
      name: 'L',
      tokens: [
        token,
        token,
        { ...token, address: '0x123' },
        { ...token, decimals: -1 },
        { ...token, symbol: '' },
        'junk',
        { ...token, chainId: 0 },
      ],
    })
    expect(Either.isRight(r) && [r.right.tokens.length, r.right.skipped]).toEqual([1, 5])
  })

  it('rejects things that are not lists', () => {
    expect(Either.isLeft(parseTokenList({ tokens: [] }))).toBe(true)
    expect(Either.isLeft(parseTokenList([token]))).toBe(true)
  })

  it('bundles a valid default list', () => {
    const r = parseTokenList(defaults)
    expect(Either.isRight(r) && r.right.skipped).toBe(0)
  })

  it('exports as a Uniswap list that parses back', () => {
    const out = exportTokenList(
      'My tokens',
      [{ chainId: 1, address: token.address, symbol: 'USDC', name: '', decimals: 6 }],
      new Date(0),
    )
    expect(out.version).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(Either.isRight(parseTokenList(out))).toBe(true)
  })

  it('flags duplicate symbols by address, per chain', () => {
    const d = duplicateSymbols([
      { chainId: 1, address: '0xA', symbol: 'USDC' },
      { chainId: 1, address: '0xB', symbol: 'usdc' },
      { chainId: 10, address: '0xC', symbol: 'USDC' },
    ])
    expect([...d].sort()).toEqual(['0xa', '0xb'])
  })
})

describe('prices', () => {
  it('scales rates as the aggregator does', () => {
    // 1 USDC = 0.0004 ETH  → rate = 0.0004 × 1e18 × 1e12
    const rate = 4n * 10n ** 26n
    expect(valueInWei(2_500_000n, rate)).toBe(10n ** 15n) // 2.5 USDC = 0.001 ETH
    expect(fiatPerEth(rate, 6)).toBeCloseTo(2500, 6)
    expect(fiatPerEth(0n, 6)).toBeUndefined()
  })
})

describe('token list sources', () => {
  it('fetches a .eth name through eth.limo', () => {
    expect(tokenListSource(' tokenlist.aave.eth ')).toEqual(
      Either.right({ url: 'https://tokenlist.aave.eth.limo/', ensName: 'tokenlist.aave.eth' }),
    )
    // Normalized (ENSIP-15) before it becomes a host
    expect(tokenListSource('TokenList.Aave.eth')).toEqual(
      Either.right({ url: 'https://tokenlist.aave.eth.limo/', ensName: 'tokenlist.aave.eth' }),
    )
  })

  it('takes https URLs as given and refuses anything else', () => {
    expect(tokenListSource('https://tokens.uniswap.org')).toEqual(
      Either.right({ url: 'https://tokens.uniswap.org' }),
    )
    expect(Either.isLeft(tokenListSource('http://tokens.uniswap.org'))).toBe(true)
    expect(Either.isLeft(tokenListSource('tokens.uniswap.org'))).toBe(true)
    expect(Either.isLeft(tokenListSource('evil.eth/../x.eth'))).toBe(true)
  })
})

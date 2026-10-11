import { type Address, encodeFunctionData, erc20Abi, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { safeManagementAbi } from '@/core/known-abis'
import type { SafeTx } from '@/core/safe-tx'
import { renderClearSigning } from './render'

const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const base: SafeTx = {
  to: USDC,
  value: 0n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 7n,
}
const deps = {
  remote: false,
  userDescriptors: [],
  trustedTokens: { 1: { [USDC.toLowerCase()]: 'erc20' as const } },
  externalDataProvider: {
    resolveToken: async () => ({ name: 'USD Coin', symbol: 'USDC', decimals: 6 }),
    resolveChainInfo: async () => ({
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    }),
  },
}
const ctx = { chainId: 1, safe, version: '1.4.1', l2: false }

describe('clear signing with bundled Safe descriptors (SPEC §7.2)', () => {
  it('renders the SafeTx through the proxy-mapped Safe descriptor, with the inner ERC-20 call from the token template', async () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: ['0x255C3912f91eF11bFDadd405F13144a823Da8cc5', 1_500_000n],
    })
    const r = await renderClearSigning(ctx, { ...base, data }, deps)
    expect(r?.via).toBe('safe-tx')
    expect(r?.level).toBe(2)
    expect(r?.summary).toBe('Send: amount 1.5 USDC, to 0x255C…8cc5')
    expect(JSON.stringify(r?.display.fields)).toContain('Operation type')
    expect(r?.sources).toEqual([
      { kind: 'bundled', path: 'registry/safe/eip712-Safe-1.4.1.json' },
      // Pulled in through the descriptor's `includes`
      { kind: 'bundled', path: 'registry/safe/common-eip712-Safe.json' },
      { kind: 'token-template' },
    ])
  })

  it('renders a call on the Safe itself on any chain, since the proxy maps to its verified version', async () => {
    const data = encodeFunctionData({
      abi: safeManagementAbi,
      functionName: 'addOwnerWithThreshold',
      args: ['0x000000000000000000000000000000000000bEEF', 2n],
    })
    const r = await renderClearSigning(
      { ...ctx, chainId: 100 },
      { ...base, to: safe, data },
      { ...deps, trustedTokens: {} },
    )
    expect(r).toBeDefined()
    expect(JSON.stringify(r?.display)).toMatch(/owner/i)
    expect(r?.sources.map((s) => s.kind === 'bundled' && s.path)).toContain(
      'registry/safe/calldata-Safe-1.4.1.json',
    )
  })

  it('renders nothing for an unknown contract without the registry', async () => {
    const r = await renderClearSigning(
      ctx,
      { ...base, to: '0x000000000000000000000000000000000000dEaD', data: '0xdeadbeef' },
      { ...deps, trustedTokens: {} },
    )
    // The SafeTx itself still renders; the inner call has no descriptor
    expect(r?.via).toBe('safe-tx')
    expect(r?.summary).toBeUndefined()
  })
})

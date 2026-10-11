import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@/netguard/log'
import type { Settings } from '@/schemas/settings'
import { groupByHost, hostRole, summarizeMethods, tagLabel } from './grouping'

const settings = {
  version: 1,
  setupDone: true,
  chains: [
    {
      id: 1,
      name: 'Ethereum',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpc: { _tag: 'url', url: 'https://rpc.mevblocker.io' },
    },
    {
      id: 11155111,
      name: 'Sepolia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpc: { _tag: 'url', url: 'https://evm.stupidtech.net/sepolia' },
    },
  ],
  capabilities: {
    tokenListOrigins: ['https://tokens.uniswap.org'],
    clearSigningDescriptors: false,
    sourcify: true,
    signatureDatabase: false,
    ccipRead: true,
  },
  trustedAuditors: [],
  currency: 'USD',
} as unknown as Settings

let id = 0
const entry = (host: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  id: ++id,
  time: 1000 + id,
  transport: 'fetch',
  host,
  path: '/',
  methods: [],
  tag: 'safe',
  outcome: 'allowed',
  ...extra,
})

describe('network log grouped by host', () => {
  it('names why each host is allowed, from your settings', () => {
    expect(hostRole('rpc.mevblocker.io', [entry('rpc.mevblocker.io')], settings).label).toBe(
      'Your Ethereum RPC',
    )
    expect(hostRole('sourcify.dev', [entry('sourcify.dev')], settings).label).toBe(
      'Sourcify, from Network access',
    )
    expect(hostRole('tokens.uniswap.org', [entry('tokens.uniswap.org')], settings).label).toBe(
      'Token list host you always allow',
    )
    const gateway = [entry('ccip.ens.xyz', { tag: 'ccip-read' })]
    expect(hostRole('ccip.ens.xyz', gateway, settings).kind).toBe('ccip')
  })

  it('says why a host was blocked', () => {
    const off = [entry('api.4byte.sourcify.dev', { outcome: 'blocked' })]
    expect(hostRole('api.4byte.sourcify.dev', off, settings).label).toBe(
      'Blocked: Signature database is off in Network access',
    )
    const stranger = [entry('evil.example', { outcome: 'blocked' })]
    expect(hostRole('evil.example', stranger, settings).label).toBe('Blocked: not in the allowlist')
  })

  it('puts blocked hosts first, then the most recent, and lists RPCs not contacted yet', () => {
    const entries = [
      entry('rpc.mevblocker.io', { methods: ['eth_call', 'eth_call', 'eth_getCode'] }),
      entry('evil.example', { outcome: 'blocked' }),
      entry('sourcify.dev'),
      entry('rpc.mevblocker.io', { outcome: 'failed', methods: ['eth_call'] }),
    ]
    const { groups, idle } = groupByHost(entries, settings)
    expect(groups.map((g) => g.host)).toEqual(['evil.example', 'rpc.mevblocker.io', 'sourcify.dev'])
    const rpc = groups[1]
    expect(rpc?.calls).toBe(4)
    expect(rpc?.failed).toBe(1)
    // Newest first within a host
    expect(rpc?.entries[0]?.outcome).toBe('failed')
    expect(idle).toEqual([
      { host: 'evm.stupidtech.net', role: { kind: 'rpc', label: 'Your Sepolia RPC' } },
    ])
  })

  it('labels tags in plain words and counts repeated calls', () => {
    expect(tagLabel('signature-db')).toBe('Function names')
    expect(tagLabel('something-new')).toBe('something-new')
    expect(tagLabel('balances+ens+safe')).toBe('Balances + ENS names + Safe')
    expect(summarizeMethods(['eth_call', 'eth_getCode', 'eth_call'])).toBe(
      'eth_call ×2, eth_getCode',
    )
  })
})

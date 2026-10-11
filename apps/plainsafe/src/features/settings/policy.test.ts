import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { policyFromSettings } from './policy'

describe('policyFromSettings', () => {
  it('allows nothing before setup is done, except origins tested this session', () => {
    expect(policyFromSettings(undefined)).toEqual({ origins: [], ccipRead: false })
    expect(policyFromSettings(defaultSettings)).toEqual({ origins: [], ccipRead: false })
    expect(policyFromSettings(defaultSettings, ['https://rpc.mevblocker.io']).origins).toEqual([
      'https://rpc.mevblocker.io',
    ])
  })

  it('allows each chain RPC origin after setup, and nothing else by default', () => {
    const p = policyFromSettings({ ...defaultSettings, setupDone: true })
    expect(p).toEqual({
      origins: ['https://evm.stupidtech.net', 'https://rpc.mevblocker.io'],
      ccipRead: false,
    })
  })

  it('skips wallet RPCs and adds enabled capability hosts', () => {
    const p = policyFromSettings({
      ...defaultSettings,
      setupDone: true,
      chains: defaultSettings.chains.map((c) => ({ ...c, rpc: { _tag: 'wallet' as const } })),
      capabilities: {
        ...defaultSettings.capabilities,
        sourcify: true,
        ccipRead: true,
        tokenListOrigins: ['https://tokens.uniswap.org'],
      },
    })
    expect(p).toEqual({
      origins: ['https://sourcify.dev', 'https://tokens.uniswap.org'],
      ccipRead: true,
    })
  })
})

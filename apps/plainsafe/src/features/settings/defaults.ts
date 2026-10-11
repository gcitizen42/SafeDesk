import { mainnet, sepolia } from 'viem/chains'
import type { Settings } from '@/schemas/settings'

// SPEC §3.1, §8.4: prefilled, editable public endpoints (the UI recommends your own). MEV Blocker
// for Mainnet, evm.stupidtech.net for every other chain.
export const defaultRpcFor = (chainId: number) =>
  chainId === mainnet.id ? 'https://rpc.mevblocker.io' : `https://evm.stupidtech.net/v1/${chainId}`

// SPEC §7.2: the auditor in the registry's auditors/ folder.
const DEFAULT_AUDITOR = 'eip155-1-0x3846c3A30E62075Fa916216b35EF04B8F53931f6'

export const defaultSettings: Settings = {
  version: 1,
  setupDone: false,
  chains: [
    {
      id: mainnet.id,
      name: 'Ethereum',
      nativeCurrency: mainnet.nativeCurrency,
      rpc: { _tag: 'url', url: defaultRpcFor(mainnet.id) },
      explorer: mainnet.blockExplorers.default.url,
    },
    {
      id: sepolia.id,
      name: 'Sepolia',
      nativeCurrency: sepolia.nativeCurrency,
      rpc: { _tag: 'url', url: defaultRpcFor(sepolia.id) },
      explorer: sepolia.blockExplorers.default.url,
    },
  ],
  capabilities: {
    tokenListOrigins: [],
    clearSigningDescriptors: false,
    sourcify: false,
    signatureDatabase: false,
    ccipRead: false,
  },
  trustedAuditors: [DEFAULT_AUDITOR],
  currency: 'USD',
}

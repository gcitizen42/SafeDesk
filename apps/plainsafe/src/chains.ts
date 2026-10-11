// viem chain objects built from settings (SPEC §3.1: chains known to viem/chains take their
// metadata and Multicall3 address from there; others use deployless multicall).
import { type Chain, defineChain } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import type { ChainSettings } from '@/schemas/settings'

const BUNDLED: Record<number, Chain> = { [mainnet.id]: mainnet, [sepolia.id]: sepolia }

export function toViemChain(c: ChainSettings): Chain {
  const known = BUNDLED[c.id]
  const rpcUrl = c.rpc._tag === 'url' ? c.rpc.url : undefined
  const base =
    known ??
    defineChain({
      id: c.id,
      name: c.name,
      nativeCurrency: c.nativeCurrency,
      rpcUrls: { default: { http: [] } },
      ...(c.multicall3 ? { contracts: { multicall3: { address: c.multicall3 } } } : {}),
    })
  return {
    ...base,
    name: c.name,
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [...base.rpcUrls.default.http] } },
    ...(c.explorer ? { blockExplorers: { default: { name: 'Explorer', url: c.explorer } } } : {}),
  }
}

/** Multicall needs `deployless` when the chain has no known Multicall3 (SPEC §8.4). */
export const needsDeployless = (chain: Chain) => !chain.contracts?.multicall3

/** Block explorer link for an address or transaction. Only ever linked to, never fetched. */
export function explorerUrl(c: ChainSettings, kind: 'address' | 'tx', value: string) {
  return c.explorer ? `${c.explorer.replace(/\/$/, '')}/${kind}/${value}` : undefined
}

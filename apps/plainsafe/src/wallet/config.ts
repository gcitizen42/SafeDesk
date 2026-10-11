// wagmi is used only for the wallet (SPEC §8.3): injected + EIP-6963 discovery, nothing else.
import type { Chain } from 'viem'
import { mainnet } from 'viem/chains'
import { createConfig, http, injected, type Transport, unstable_connector } from 'wagmi'
import { toViemChain } from '@/chains'
import { netguard } from '@/netguard'
import type { ChainSettings } from '@/schemas/settings'

export function makeWagmiConfig(chains: readonly ChainSettings[]) {
  // wagmi needs at least one chain
  const all = (chains.length ? chains.map(toViemChain) : [mainnet]) as [Chain, ...Chain[]]
  const transports: Record<number, Transport> = {}
  for (const c of chains) {
    transports[c.id] =
      c.rpc._tag === 'url'
        ? http(c.rpc.url, { fetchFn: netguard.fetchFor(`wagmi:${c.id}`) })
        : unstable_connector(injected)
  }
  if (!chains.length) transports[mainnet.id] = unstable_connector(injected)
  return createConfig({
    chains: all,
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    // wagmi's default storage is the browser's Web Storage, which SPEC §9.5 forbids.
    storage: null,
    transports,
  })
}

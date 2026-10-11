// viem clients for an RPC endpoint: a URL (through netguard, tagged) or the wallet's provider.
import { createPublicClient, custom, type EIP1193Provider, http, type PublicClient } from 'viem'
import { WALLET_ENDPOINT } from '@/lib/errors'
import { netguard } from '@/netguard'

export type Endpoint =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'wallet'; readonly provider: EIP1193Provider }

export const endpointLabel = (e: Endpoint) => (e.kind === 'url' ? e.url : WALLET_ENDPOINT)

/** `tag` names the part of the app making the requests, for the network log (SPEC §8.1). */
export function publicClientFor(endpoint: Endpoint, tag: string): PublicClient {
  const transport =
    endpoint.kind === 'url'
      ? http(endpoint.url, { fetchFn: netguard.fetchFor(tag), retryCount: 0, timeout: 20_000 })
      : custom(endpoint.provider, { retryCount: 0 })
  return createPublicClient({ transport })
}

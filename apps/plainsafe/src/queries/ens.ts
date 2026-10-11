import { useQueries, useQuery } from '@tanstack/react-query'
import { type Address, isAddress } from 'viem'
import { ensChainFor } from '@/core/ens'
import { run } from '@/effect/run'
import { lookupName, resolveName } from '@/features/ens/program'
import { useDebounced } from '@/lib/use-debounced'
import { keys } from './keys'
import { useOfflineView } from './offline'
import { useLoadedSettings } from './settings'

/** ENS is on only when the RPC for the ENS chain is set up (SPEC §8.5), outside offline views. */
function useEnsAvailable(chainId: number) {
  const settings = useLoadedSettings()
  const offline = useOfflineView()
  const ensChain = ensChainFor(chainId)
  return !offline && settings.setupDone && settings.chains.some((c) => c.id === ensChain)
}

const ensNameQuery = (chainId: number, address: Address | undefined, available: boolean) => ({
  queryKey: keys.ens(chainId, address ?? '0x'),
  queryFn: () => run(lookupName(chainId, address as Address)),
  enabled: available && !!address,
  staleTime: 5 * 60_000,
  retry: false,
})

export function useEnsName(chainId: number, address: Address | undefined) {
  const available = useEnsAvailable(chainId)
  return useQuery(ensNameQuery(chainId, address, available))
}

/** `useEnsName` for several addresses, in the same order; shares its cache. */
export function useEnsNames(chainId: number, addresses: readonly Address[]) {
  const available = useEnsAvailable(chainId)
  return useQueries({ queries: addresses.map((a) => ensNameQuery(chainId, a, available)) })
}

export const looksLikeEnsName = (text: string) =>
  /\.[a-z]{2,}$/i.test(text.trim()) && !text.trim().startsWith('0x')

interface ResolvedAddress {
  readonly address?: Address
  readonly name?: string
  readonly pending: boolean
  readonly error?: string
}

/** How long a typed name must stay unchanged before it's resolved (SPEC §8.5). */
const ENS_INPUT_DEBOUNCE_MS = 400

/** An address field's value: a 0x address, or an ENS name resolved for the Safe's chain. */
export function useResolvedAddress(chainId: number, text: string): ResolvedAddress {
  const t = text.trim()
  const available = useEnsAvailable(chainId)
  const isName = looksLikeEnsName(t)
  // Resolve only once typing pauses: "vitalik.et" is a valid-looking name on the way to
  // "vitalik.eth", and each lookup is an RPC call.
  const settled = useDebounced(t, ENS_INPUT_DEBOUNCE_MS)
  const typing = settled !== t
  const query = useQuery({
    queryKey: keys.ensResolve(chainId, settled),
    queryFn: () => run(resolveName(chainId, settled)),
    enabled: available && !typing && looksLikeEnsName(settled),
    staleTime: 5 * 60_000,
    retry: false,
  })
  if (isAddress(t, { strict: true })) return { address: t as Address, pending: false } as const
  if (!isName) return { pending: false } as const
  if (!available)
    return { pending: false, error: 'ENS needs a Mainnet RPC (or Sepolia for Sepolia).' } as const
  // Never show the answer for an earlier spelling while the new one waits
  if (typing) return { pending: true } as const
  if (query.data)
    return { address: query.data.address, name: query.data.name, pending: false } as const
  return {
    pending: query.isFetching,
    ...(query.error ? { error: query.error.message } : {}),
  } as const
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { run } from '@/effect/run'
import { applySettingsPolicy } from '@/features/settings/policy-sync'
import { loadSettings, saveSettings } from '@/features/settings/store'
import type { Settings } from '@/schemas/settings'
import { keys } from './keys'

export function useSettings() {
  return useQuery({
    queryKey: keys.settings(),
    // Applied before any component sees them: child effects run before parent effects, so a
    // deep link's first query would otherwise race the Rpc service and netguard.
    queryFn: () =>
      run(loadSettings).then((settings) => {
        applySettingsPolicy(settings)
        return settings
      }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

/** Settings, for components rendered only after the app has loaded them (see app.tsx). */
export function useLoadedSettings(): Settings {
  const { data } = useSettings()
  if (!data) throw new Error('Settings are not loaded yet')
  return data
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: Settings) => {
      await run(saveSettings(settings))
      applySettingsPolicy(settings)
      return settings
    },
    onSuccess: (settings) => queryClient.setQueryData(keys.settings(), settings),
  })
}

/** A chain's settings, or undefined if it isn't set up. */
export const useChain = (chainId: number) =>
  useLoadedSettings().chains.find((c) => c.id === chainId)

/** Assumed for a chain that isn't set up. */
const ETHER = { name: 'Ether', symbol: 'ETH', decimals: 18 } as const

export const useNativeCurrency = (chainId: number) => useChain(chainId)?.nativeCurrency ?? ETHER

/** Names chains for display: "Chain 10" for one that isn't set up. */
export function useChainName() {
  const { chains } = useLoadedSettings()
  return (chainId: number) => chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`
}

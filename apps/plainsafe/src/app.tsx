import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { memo, useLayoutEffect, useMemo } from 'react'
import { WagmiProvider } from 'wagmi'
import { Router } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HistorySync } from '@/features/history/history-sync'
import { defaultSettings } from '@/features/settings/defaults'
import { usePolicySync } from '@/features/settings/policy-sync'
import { useSaveSettings, useSettings } from '@/queries/settings'
import { Routes } from '@/routes'
import type { ChainSettings } from '@/schemas/settings'
import { makeWagmiConfig } from '@/wallet/config'
import { WalletSync } from '@/wallet/wallet-sync'

const queryClient = new QueryClient({
  defaultOptions: {
    // No surprise background requests: data refreshes when a view asks for it.
    queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Loaded />
    </QueryClientProvider>
  )
}

function Loaded() {
  const settings = useSettings()
  usePolicySync(settings.data)
  // index.html's splash covers the page until now. A layout effect removes it before this render
  // is painted, so there's no blank frame between the two.
  useLayoutEffect(() => {
    if (!settings.isPending) document.getElementById('splash')?.remove()
  }, [settings.isPending])
  if (settings.isPending) return null
  if (settings.isError) return <SettingsError error={settings.error} />
  return <Shell chains={settings.data.chains} />
}

const chainsKey = (chains: readonly ChainSettings[]) =>
  JSON.stringify(chains.map((c) => [c.id, c.rpc]))

/**
 * Re-renders only when chains or their RPCs change (SPEC §8.3: the wagmi config is rebuilt
 * then). Everything inside reads settings through hooks.
 */
const Shell = memo(
  function Shell({ chains }: { chains: readonly ChainSettings[] }) {
    const key = chainsKey(chains)
    // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt only when `key` changes
    const config = useMemo(() => makeWagmiConfig(chains), [key])
    return (
      <WagmiProvider config={config}>
        <TooltipProvider>
          <WalletSync />
          <HistorySync />
          <Router hook={useHashLocation}>
            <Header />
            <main>
              <Routes />
            </main>
          </Router>
        </TooltipProvider>
      </WagmiProvider>
    )
  },
  (a, b) => chainsKey(a.chains) === chainsKey(b.chains),
)

/** SPEC §9.5: an invalid stored record is reported, never silently used. */
function SettingsError({ error }: { error: Error }) {
  const save = useSaveSettings()
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-xl font-semibold">Your saved settings are invalid</h1>
      <p>
        Plain Safe did not use them. This can happen if the stored data was changed outside the app.
      </p>
      <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{error.message}</pre>
      <Button
        className="self-start"
        variant="destructive"
        onClick={() => save.mutate(defaultSettings)}
      >
        Reset settings and run setup again
      </Button>
    </div>
  )
}

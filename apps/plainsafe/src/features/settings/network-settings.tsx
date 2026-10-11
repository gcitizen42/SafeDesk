// Settings → Network access and Network log (SPEC §3.12, §8.1, §8.2).
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { LogSummary, NetworkLogList } from '@/features/network-log/network-log'
import { useNetLog } from '@/features/network-log/use-net-log'
import { netguard, originOf } from '@/netguard'
import { isAnyChainKey } from '@/queries/keys'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import type { Settings } from '@/schemas/settings'
import { CAPABILITIES } from './capabilities'
import { CapabilityHosts } from './capability-hosts'

/** Save, then refetch everything read from a chain: a capability can change what it shows. */
function useSaveCapabilities() {
  const save = useSaveSettings()
  const queryClient = useQueryClient()
  // Chained on the save, not passed to mutate: it must run even if this screen closes first
  return (next: Settings) =>
    save.mutateAsync(next).then(
      () => queryClient.invalidateQueries({ predicate: (q) => isAnyChainKey(q.queryKey) }),
      () => undefined,
    )
}

export function NetworkAccessSettings() {
  const settings = useLoadedSettings()
  const save = useSaveCapabilities()
  const caps = settings.capabilities
  const rpcHosts = [
    ...new Set(
      settings.chains.flatMap((c) =>
        c.rpc._tag === 'url' ? [originOf(c.rpc.url) ?? c.rpc.url] : [],
      ),
    ),
  ]
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Network access</h2>
        <p className="text-sm text-muted-foreground">
          By default Plain Safe contacts only your RPCs. Each capability below contacts exactly the
          host shown, and only while it's on. Everything is recorded in the network log.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Always</h3>
        <p className="text-sm">
          Your RPCs:{' '}
          <span className="font-mono text-xs">
            {rpcHosts.length ? rpcHosts.join(', ') : 'none (wallet RPC only)'}
          </span>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Capabilities (off by default)</h3>
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="capabilities">
          {CAPABILITIES.map((c) => (
            <li key={c.key} className="flex items-start gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{c.label}</span>
                <span className="text-sm text-muted-foreground">{c.usedFor}</span>
                <CapabilityHosts cap={c} />
              </div>
              <Switch
                checked={caps[c.key]}
                aria-label={c.label}
                data-capability={c.key}
                onCheckedChange={(on) =>
                  save({ ...settings, capabilities: { ...caps, [c.key]: on } })
                }
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Token list hosts you always allow</h3>
        {caps.tokenListOrigins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None. When you import a token list by URL, Plain Safe asks whether to fetch it once or
            always allow its host.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {caps.tokenListOrigins.map((o) => (
              <li key={o} className="flex items-center gap-3 p-3">
                <span className="flex-1 font-mono text-xs">{o}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Stop allowing ${o}`}
                  onClick={() =>
                    save({
                      ...settings,
                      capabilities: {
                        ...caps,
                        tokenListOrigins: caps.tokenListOrigins.filter((x) => x !== o),
                      },
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export function NetworkLogSettings() {
  const entries = useNetLog()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Network log</h2>
      <p className="text-sm text-muted-foreground">
        Every request this tab attempted since it opened, allowed or blocked. It's kept in memory
        only and is also available from the indicator in the header.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <LogSummary entries={entries} />
        <Button variant="outline" size="sm" onClick={() => netguard.log.clear()}>
          Clear
        </Button>
      </div>
      <NetworkLogList entries={entries} />
    </section>
  )
}

// First-run setup (SPEC §3.1). No request leaves the browser until the user presses Test or
// finishes setup.
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { mainnet } from 'viem/chains'
import { useLocation } from 'wouter'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AddChainForm } from '@/features/safes/add-chain'
import { CAPABILITIES } from '@/features/settings/capabilities'
import { CapabilityHosts } from '@/features/settings/capability-hosts'
import { describeError } from '@/lib/errors'
import { useSaveSettings } from '@/queries/settings'
import type { Capabilities, Settings } from '@/schemas/settings'
import { requestPersistence } from '@/storage/db'
import { ChainRpcCard, draftOf, draftProblem, rpcOf } from './chain-rpc-card'
import { markSetupCompleted, takeReturnTo } from './return-to'

export function SetupScreen({ settings }: { settings: Settings }) {
  const [drafts, setDrafts] = useState(() => settings.chains.map(draftOf))
  const [adding, setAdding] = useState(false)
  const [caps, setCaps] = useState<Capabilities>(settings.capabilities)
  const save = useSaveSettings()
  const [, navigate] = useLocation()
  const invalid = drafts.length === 0 || drafts.some(draftProblem)

  const onContinue = () => {
    const chains = drafts.map((d) => ({ ...d.chain, rpc: rpcOf(d) }))
    // Chained on the save, not passed to mutate, so it runs even if this screen closes first. A
    // failed save is shown below from save.error.
    save.mutateAsync({ ...settings, chains, capabilities: caps, setupDone: true }).then(
      () => {
        markSetupCompleted()
        void requestPersistence()
        navigate(takeReturnTo() ?? '/add', { replace: true })
      },
      () => undefined,
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Set up Plain Safe</h1>
        <p className="text-lg" data-testid="promise">
          Plain Safe talks to one RPC you choose. Nothing else, unless you turn it on.
        </p>
      </div>

      {drafts.map((draft, i) => (
        <ChainRpcCard
          key={draft.chain.id}
          draft={draft}
          onChange={(next) => setDrafts((ds) => ds.map((d, j) => (j === i ? next : d)))}
          onRemove={() => setDrafts((ds) => ds.filter((d) => d.chain.id !== draft.chain.id))}
        />
      ))}
      {drafts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          These are public endpoints. For privacy and reliability, use your own RPC (your node or a
          provider you trust).
        </p>
      )}
      {drafts.length > 0 && !drafts.some((d) => d.chain.id === mainnet.id) && (
        <p className="text-sm text-muted-foreground">
          Without Ethereum, fiat values and most ENS names are off, since both are read from
          Ethereum.
        </p>
      )}

      {adding || drafts.length === 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Add a chain</h2>
          <AddChainForm
            existing={drafts.map((d) => d.chain.id)}
            onAdd={(chain) => {
              setDrafts((ds) => [...ds, draftOf(chain)])
              setAdding(false)
            }}
          />
        </section>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
          Add a chain
        </Button>
      )}

      <OptionalNetworkAccess caps={caps} onChange={setCaps} />

      <div className="flex flex-col items-end gap-2">
        {save.error && (
          <p className="text-sm text-destructive">
            Couldn't save settings: {describeError(save.error)}
          </p>
        )}
        {drafts.length === 0 && (
          <p className="text-sm text-muted-foreground">Add at least one chain to continue.</p>
        )}
        <Button size="lg" disabled={invalid || save.isPending} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function OptionalNetworkAccess(props: { caps: Capabilities; onChange: (c: Capabilities) => void }) {
  const { caps, onChange } = props
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between p-4 text-left font-medium">
        Optional network access
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 px-4 pb-4">
        <p className="text-sm text-muted-foreground">
          All off by default. Each one lists what it contacts. You can change these later in
          Settings.
        </p>
        {CAPABILITIES.map((cap) => (
          <div key={cap.key} className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`cap-${cap.key}`}>{cap.label}</Label>
              <span className="text-sm text-muted-foreground">{cap.usedFor}</span>
              <CapabilityHosts cap={cap} />
            </div>
            <Switch
              id={`cap-${cap.key}`}
              checked={caps[cap.key]}
              onCheckedChange={(on) => onChange({ ...caps, [cap.key]: on })}
            />
          </div>
        ))}
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Token lists by URL or ENS</span>
          <span className="text-sm text-muted-foreground">
            Pasting or uploading a list needs nothing. When you import one by URL or by ENS name
            (fetched through eth.limo), Plain Safe asks before contacting that host.
          </span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

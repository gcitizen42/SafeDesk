// Settings → RPCs (SPEC §3.12, §8.4): edit, test, "use my wallet's RPC", add or remove a chain.
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AddChain } from '@/features/safes/add-chain'
import { ChainRpcCard, draftOf, draftProblem, rpcOf } from '@/features/setup/chain-rpc-card'
import { describeError } from '@/lib/errors'
import { isChainKey } from '@/queries/keys'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import type { ChainSettings } from '@/schemas/settings'

const sameRpc = (a: ChainSettings['rpc'], b: ChainSettings['rpc']) =>
  a._tag === b._tag && (a._tag === 'wallet' || (b._tag === 'url' && a.url === b.url))

export function RpcSettings() {
  const settings = useLoadedSettings()
  // Remount the editor when chains are added or removed, so drafts start from what's saved.
  return <RpcEditor key={settings.chains.map((c) => c.id).join(',')} />
}

function RpcEditor() {
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState(() => settings.chains.map(draftOf))
  const [adding, setAdding] = useState(false)
  const changed = drafts.filter((d) => {
    const saved = settings.chains.find((c) => c.id === d.chain.id)
    return saved && !sameRpc(saved.rpc, rpcOf(d))
  })
  const invalid = drafts.some(draftProblem)

  // SPEC §9.3: a chain's RPC changing invalidates every key for that chain.
  const invalidate = (ids: readonly number[]) =>
    queryClient.invalidateQueries({
      predicate: (q) => ids.some((id) => isChainKey(id)(q.queryKey)),
    })

  const onSave = async () => {
    const chains = settings.chains.map((c) => {
      const d = drafts.find((x) => x.chain.id === c.id)
      return d ? { ...c, rpc: rpcOf(d) } : c
    })
    await save.mutateAsync({ ...settings, chains })
    await invalidate(changed.map((d) => d.chain.id))
  }

  const remove = async (id: number) => {
    await save.mutateAsync({ ...settings, chains: settings.chains.filter((c) => c.id !== id) })
    await invalidate([id])
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">RPCs</h2>
        <p className="text-sm text-muted-foreground">
          Plain Safe reads each chain only through the RPC set here, and never falls back to another
          one. The defaults are public endpoints; for privacy and reliability, use your own node or
          a provider you trust.
        </p>
      </section>
      {drafts.map((draft, i) => (
        <ChainRpcCard
          key={draft.chain.id}
          draft={draft}
          onChange={(next) => setDrafts((ds) => ds.map((d, j) => (j === i ? next : d)))}
          onRemove={() => {
            if (
              window.confirm(
                `Remove ${draft.chain.name}? Safes on it stay saved but can't be read until you add it again.`,
              )
            )
              void remove(draft.chain.id)
          }}
        />
      ))}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {save.error && <p className="text-sm text-destructive">{describeError(save.error)}</p>}
        {changed.length > 0 && (
          <span className="text-sm text-muted-foreground">
            Unsaved changes for {changed.map((d) => d.chain.name).join(', ')}
          </span>
        )}
        <Button disabled={invalid || changed.length === 0 || save.isPending} onClick={onSave}>
          Save RPCs
        </Button>
      </div>
      {adding ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Add a chain</h3>
          <AddChain onAdded={() => setAdding(false)} />
        </section>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
          Add a chain
        </Button>
      )}
    </div>
  )
}

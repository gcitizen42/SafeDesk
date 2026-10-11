// Adding a chain (SPEC §3.1 "Other chains"): only the chain ID is required.
import { Schema } from 'effect'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { defaultRpcFor } from '@/features/settings/defaults'
import { describeError } from '@/lib/errors'
import { useUrlRpcTest } from '@/queries/rpc-test'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import { ChainId, RpcUrl } from '@/schemas/common'
import type { ChainSettings } from '@/schemas/settings'

type KnownChain = typeof import('virtual:viem-chains').default[number]

/** A lazy chunk from the app's own origin: only the fields used here, from viem/chains. */
async function findViemChain(id: number): Promise<KnownChain | undefined> {
  const { default: chains } = await import('virtual:viem-chains')
  return chains[id]
}

/** Adds the chain to saved settings right away. */
export function AddChain({
  onAdded,
  initialChainId,
}: {
  onAdded: (chainId: number) => void
  initialChainId?: number
}) {
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  return (
    <AddChainForm
      existing={settings.chains.map((c) => c.id)}
      initialChainId={initialChainId}
      pending={save.isPending}
      onAdd={async (chain) => {
        await save.mutateAsync({ ...settings, chains: [...settings.chains, chain] })
        onAdded(chain.id)
      }}
    />
  )
}

/** The form alone: `onAdd` gets a chain whose RPC answered with a matching chain ID. */
export function AddChainForm({
  existing,
  onAdd,
  pending = false,
  initialChainId,
}: {
  existing: readonly number[]
  onAdd: (chain: ChainSettings) => void | Promise<void>
  pending?: boolean
  initialChainId?: number
}) {
  const [idText, setIdText] = useState(initialChainId ? String(initialChainId) : '')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [known, setKnown] = useState<KnownChain | undefined>()

  const id = Schema.decodeUnknownOption(ChainId)(Number(idText))
  const chainId = id._tag === 'Some' ? id.value : undefined
  const exists = chainId !== undefined && existing.includes(chainId)

  useEffect(() => {
    setKnown(undefined)
    if (chainId === undefined) return
    setUrl(defaultRpcFor(chainId))
    let cancelled = false
    void findViemChain(chainId).then((c) => {
      if (cancelled) return
      setKnown(c)
      setName(c?.name ?? '')
      setSymbol(c?.nativeCurrency.symbol ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [chainId])

  const rpcUrl = url.trim()
  const urlOk = Schema.is(RpcUrl)(rpcUrl)
  const test = useUrlRpcTest(rpcUrl)
  const matches = test.data?.chainId === chainId
  const canAdd =
    chainId !== undefined && !exists && urlOk && matches && name.trim() && symbol.trim()

  const add = async () => {
    if (!canAdd) return
    const chain: ChainSettings = {
      id: chainId,
      name: name.trim(),
      nativeCurrency: known?.nativeCurrency ?? {
        name: symbol.trim(),
        symbol: symbol.trim(),
        decimals: 18,
      },
      rpc: { _tag: 'url', url: rpcUrl },
      ...(known?.explorer ? { explorer: known.explorer } : {}),
      ...(known?.multicall3 ? { multicall3: known.multicall3 } : {}),
    }
    await onAdd(chain)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chain-id">Chain ID</Label>
        <Input
          id="chain-id"
          inputMode="numeric"
          value={idText}
          onChange={(e) => setIdText(e.target.value.trim())}
          placeholder="e.g. 8453"
        />
        {exists && <p className="text-sm text-muted-foreground">This chain is already set up.</p>}
      </div>
      {chainId !== undefined && !exists && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chain-name">Name</Label>
              <Input
                id="chain-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!known}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chain-symbol">Currency symbol</Label>
              <Input
                id="chain-symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                disabled={!!known}
              />
            </div>
          </div>
          {!known && (
            <p className="text-sm text-muted-foreground">
              This chain isn't in viem's list, so enter its name and currency. Reads use deployless
              multicall.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chain-rpc">RPC URL</Label>
            <Input
              id="chain-rpc"
              className="font-mono text-sm"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            <p className="text-sm text-muted-foreground">
              This is a public endpoint. For privacy and reliability, use your own RPC (your node or
              a provider you trust).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={!urlOk || test.isFetching}
              onClick={() => void test.refetch()}
            >
              {test.isFetching ? 'Testing…' : 'Test'}
            </Button>
            {test.error && !test.isFetching && (
              <span className="text-sm text-destructive">{describeError(test.error)}</span>
            )}
            {test.data && !test.isFetching && (
              <span
                className={
                  matches
                    ? 'text-sm text-emerald-700 dark:text-emerald-400'
                    : 'text-sm text-destructive'
                }
              >
                {matches
                  ? 'Chain ID matches.'
                  : `This RPC is on chain ${test.data.chainId}, not ${chainId}.`}
              </span>
            )}
            <Button
              size="sm"
              className="ml-auto"
              disabled={!canAdd || pending}
              onClick={() => void add()}
            >
              Add chain
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

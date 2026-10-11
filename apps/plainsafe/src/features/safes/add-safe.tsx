// Add a Safe (SPEC §3.2): chain + address, one pinned-block read, the authenticity check, labels.
import { useState } from 'react'
import type { Address } from 'viem'
import { Link, useLocation } from 'wouter'
import { AddressField } from '@/components/inputs'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useEnsNames, useResolvedAddress } from '@/queries/ens'
import { useLabelOf, useSafe, useSafeList, useSaveSafe, useSetLabels } from '@/queries/safes'
import { useLoadedSettings } from '@/queries/settings'
import { AddChain } from './add-chain'
import type { SafeSnapshot } from './load-safe'
import { SafeFacts } from './safe-summary'
import { hasSafe, safeRecord } from './store'

export function AddSafe() {
  const settings = useLoadedSettings()
  const [chainId, setChainId] = useState<number | undefined>(settings.chains[0]?.id)
  const [addressText, setAddressText] = useState('')
  const [target, setTarget] = useState<{ chainId: number; address: Address } | undefined>()

  const resolved = useResolvedAddress(chainId ?? 1, addressText)
  const safe = useSafe(target?.chainId ?? 0, target?.address)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Add a Safe</h1>
      <AddTabs current="existing" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (chainId !== undefined && resolved.address)
            setTarget({ chainId, address: resolved.address })
        }}
      >
        <ChainPicker
          value={chainId}
          onChange={(id) => {
            setChainId(id)
            setTarget(undefined)
          }}
        />
        <AddressField
          label="Safe address"
          chainId={chainId ?? 1}
          value={addressText}
          onChange={(v) => {
            setAddressText(v)
            setTarget(undefined)
          }}
        />
        <Button
          type="submit"
          className="self-start"
          disabled={chainId === undefined || !resolved.address}
        >
          Check Safe
        </Button>
      </form>

      {target && safe.isFetching && !safe.data && (
        <p className="text-muted-foreground">Reading the Safe at the latest block…</p>
      )}
      {target && safe.error && (
        <div className="flex flex-col gap-2">
          <p className="text-destructive">{describeError(safe.error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void safe.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {target && safe.data && <Result safe={safe.data} />}
    </div>
  )
}

function Result({ safe }: { safe: SafeSnapshot }) {
  const mySafes = useSafeList('safes')
  const labelOf = useLabelOf()
  const saveSafe = useSaveSafe('safes')
  const setLabels = useSetLabels()
  const [, navigate] = useLocation()
  const [labels, setLabelsState] = useState<Record<string, string>>({})
  // An owner with an ENS primary name is already named: only the others get a label field, once
  // their lookup has settled, so a label can't be typed into a field that then disappears.
  const ens = useEnsNames(safe.chainId, safe.owners ?? [])
  const unnamed = (safe.owners ?? []).filter((_, i) => !ens[i]?.isLoading && !ens[i]?.data)
  const href = `/safe/${safe.chainId}/${safe.address}`
  const already = mySafes.data && hasSafe(mySafes.data.safes, safe.chainId, safe.address)
  const a = safe.authenticity
  const saveError = setLabels.error ?? saveSafe.error

  const add = async () => {
    const record = safeRecord(safe)
    if (!record) return
    setLabels.reset()
    const entries = unnamed
      .map((address) => ({
        chainId: safe.chainId,
        address,
        label: (labels[address] ?? '').trim(),
      }))
      .filter((e) => e.label)
    if (entries.length) await setLabels.mutateAsync(entries)
    await saveSafe.mutateAsync(record)
    navigate(href)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-sm break-all">{safe.address}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SafeFacts safe={safe} />
        {a.status === 'verified' && unnamed.length > 0 && !already && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              Label owners (optional, saved to your address book)
            </h3>
            {unnamed.map((o) => (
              <div key={o} className="flex items-center gap-2">
                <span className="w-32 shrink-0 font-mono text-xs">{`${o.slice(0, 8)}…${o.slice(-6)}`}</span>
                <Input
                  aria-label={`Label for ${o}`}
                  placeholder={labelOf(safe.chainId, o) ?? 'Label'}
                  value={labels[o] ?? ''}
                  maxLength={64}
                  onChange={(e) => setLabelsState((l) => ({ ...l, [o]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {a.status === 'verified' && !already && (
            <Button
              onClick={() => void add().catch(() => undefined)}
              disabled={setLabels.isPending || saveSafe.isPending}
            >
              Add to My Safes
            </Button>
          )}
          {already && <span className="text-sm text-muted-foreground">Already in My Safes.</span>}
          <Button variant="outline" asChild>
            <Link href={href}>{a.status === 'verified' ? 'Open' : 'View read-only'}</Link>
          </Button>
        </div>
        {saveError && <p className="text-sm text-destructive">{describeError(saveError)}</p>}
      </CardContent>
    </Card>
  )
}

/** Existing Safe or a new one (SPEC §3.2, §3.14). */
export function AddTabs({ current }: { current: 'existing' | 'new' }) {
  const tab = (href: string, active: boolean, text: string) => (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm',
        active ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {text}
    </Link>
  )
  return (
    <nav className="flex gap-1 self-start rounded-lg border p-1" aria-label="Add a Safe">
      {tab('/add', current === 'existing', 'Existing Safe')}
      {tab('/add/new', current === 'new', 'New Safe')}
    </nav>
  )
}

const OTHER = 'other'

/**
 * The configured chains, or "Other chain…" (`undefined`) to add one by chain ID and RPC; once
 * added, it's selected.
 */
export function ChainPicker(props: {
  value: number | undefined
  onChange: (chainId: number | undefined) => void
}) {
  const settings = useLoadedSettings()
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chain">Chain</Label>
        <Select
          id="chain"
          value={props.value ?? OTHER}
          onChange={(e) =>
            props.onChange(e.target.value === OTHER ? undefined : Number(e.target.value))
          }
        >
          {settings.chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.id})
            </option>
          ))}
          <option value={OTHER}>Other chain…</option>
        </Select>
      </div>
      {props.value === undefined && <AddChain onAdded={props.onChange} />}
    </>
  )
}

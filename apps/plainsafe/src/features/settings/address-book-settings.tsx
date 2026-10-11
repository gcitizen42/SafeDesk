// Settings → Address book (SPEC §3.12). Labels come only from here, never from packages (§6).
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AddressField } from '@/components/inputs'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useResolvedAddress } from '@/queries/ens'
import { useAddressBook, useRemoveLabel, useSetLabels } from '@/queries/safes'
import { useChainName, useLoadedSettings } from '@/queries/settings'

export function AddressBookSettings() {
  const book = useAddressBook()
  const setLabels = useSetLabels()
  const remove = useRemoveLabel()
  const nameOf = useChainName()
  const chainName = (id: number | '*') => (id === '*' ? 'All chains' : nameOf(id))
  const entries = [...(book.data?.entries ?? [])].sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Address book</h2>
        <p className="text-sm text-muted-foreground">
          Your own names for addresses, shown wherever the address appears. A shared transaction can
          never add or change a label.
        </p>
      </section>
      {book.data && book.data.invalid.length > 0 && (
        <p className="text-sm text-destructive">
          {book.data.invalid.length} saved label(s) are invalid and were not used.
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No labels yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="address-book">
          {entries.map((e) => (
            <li key={`${e.chainId}:${e.address}`} className="flex items-center gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Input
                  aria-label={`Label for ${e.address}`}
                  defaultValue={e.label}
                  maxLength={64}
                  onBlur={(ev) => {
                    const label = ev.target.value.trim()
                    if (label && label !== e.label) setLabels.mutate([{ ...e, label }])
                  }}
                />
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {e.address} · {chainName(e.chainId)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete the label ${e.label}`}
                onClick={() => remove.mutate({ chainId: e.chainId, address: e.address })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddLabel />
    </div>
  )
}

function AddLabel() {
  const settings = useLoadedSettings()
  const setLabels = useSetLabels()
  const [chain, setChain] = useState<string>('*')
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const chainId = chain === '*' ? '*' : Number(chain)
  // ENS names resolve for the chosen chain (Mainnet for "All chains")
  const ensChainId = chainId === '*' ? 1 : chainId
  const resolved = useResolvedAddress(ensChainId, text)
  const ok = !!resolved.address && label.trim().length > 0
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="font-medium">Add a label</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label-chain">Chain</Label>
        <Select id="label-chain" value={chain} onChange={(e) => setChain(e.target.value)}>
          <option value="*">All chains</option>
          {settings.chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <AddressField label="Address" chainId={ensChainId} value={text} onChange={setText} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label-text">Label</Label>
        <Input
          id="label-text"
          value={label}
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <Button
        className="self-start"
        disabled={!ok || setLabels.isPending}
        onClick={() => {
          if (!resolved.address) return
          setLabels.mutate([{ chainId, address: resolved.address, label: label.trim() }], {
            onSuccess: () => {
              setText('')
              setLabel('')
            },
          })
        }}
      >
        Save label
      </Button>
    </section>
  )
}

import { Check, Download, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchPublicChains, type PublicChain, type PublicChainCatalog } from './chain-catalog'

export function ChainPicker({ onChoose }: { onChoose: (chain: PublicChain) => void }) {
  const id = useId()
  const request = useRef<AbortController | null>(null)
  const [catalogue, setCatalogue] = useState<PublicChainCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => () => request.current?.abort(), [])

  const load = async () => {
    if (request.current && !request.current.signal.aborted) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setFailed(false)
    setCatalogue(null)
    setSelectedId('')
    try {
      const result = await fetchPublicChains(controller.signal)
      if (!controller.signal.aborted) setCatalogue(result)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (request.current === controller) {
        request.current = null
        if (!controller.signal.aborted) setLoading(false)
      }
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (catalogue?.chains ?? []).filter((chain) =>
      `${chain.name} ${chain.chainId} ${chain.nativeCurrency.symbol}`.toLowerCase().includes(query),
    )
  }, [catalogue, search])
  const selected = filtered.find((chain) => String(chain.chainId) === selectedId)

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {loading ? 'Loading chains...' : 'Load public chains'}
        </Button>
        <a
          href="https://chainlist.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline underline-offset-4"
        >
          Chainlist
        </a>
        {catalogue?.source === 'built-in' && (
          <span role="status" className="text-sm text-muted-foreground">
            Built-in catalogue
          </span>
        )}
      </div>
      {failed && (
        <span role="alert" className="text-sm text-destructive">
          Public chain catalogue is unavailable. Try again.
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-search`}>Search chains</Label>
        <Input
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          maxLength={120}
          disabled={!catalogue || loading}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setSelectedId('')
          }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${id}-chain`}>Chain</Label>
        <Select
          id={`${id}-chain`}
          className="w-full min-w-0 max-w-full"
          disabled={!catalogue || loading || filtered.length === 0}
          value={selected ? selectedId : ''}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="">
            {catalogue && filtered.length === 0 ? 'No matching chains' : 'Choose a chain'}
          </option>
          {filtered.map((chain) => (
            <option key={chain.chainId} value={String(chain.chainId)}>
              {chain.name} ({chain.chainId}){chain.testnet ? ' - Testnet' : ''}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        className="self-start"
        disabled={!selected || loading}
        onClick={() => {
          if (selected && !loading) onChoose(selected)
        }}
      >
        <Check aria-hidden="true" />
        Pick chain
      </Button>
    </section>
  )
}

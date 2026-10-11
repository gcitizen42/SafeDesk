// Settings → Token lists and My tokens (SPEC §3.12, §10).
import { Either } from 'effect'
import { Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FileButton } from '@/components/file-button'
import { AddressField } from '@/components/inputs'
import { Select } from '@/components/select'
import { TokenMonogram } from '@/components/token-monogram'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { exportTokenList, type ListSource, parseTokenList, tokenListSource } from '@/core/tokenlist'
import { BUILT_IN_ID } from '@/features/tokens/store'
import { downloadJson } from '@/lib/download'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { netguard, originOf } from '@/netguard'
import { useResolvedAddress } from '@/queries/ens'
import { useChainName, useLoadedSettings, useSaveSettings } from '@/queries/settings'
import { useMyTokens, useTokenLists, useTokenMutations } from '@/queries/tokens'
import { grantOrigin, revokeGrant } from './policy-sync'

export function TokensSettings() {
  return (
    <div className="flex flex-col gap-8">
      <TokenLists />
      <MyTokens />
    </div>
  )
}

function TokenLists() {
  const lists = useTokenLists()
  const m = useTokenMutations()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Token lists</h2>
      <p className="text-sm text-muted-foreground">
        Lists apply to every Safe on a matching chain. Tokens are identified by address, never by
        symbol. Logos are never loaded.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="token-lists">
        {lists.data?.lists.map((l) => (
          <li key={l.id} className="flex items-center gap-3 p-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{l.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {l.tokens.length} tokens · {l.source}
              </span>
            </div>
            <Switch
              checked={l.enabled}
              aria-label={`Use ${l.name}`}
              onCheckedChange={(enabled) => m.setEnabled.mutate({ id: l.id, enabled })}
            />
            {l.id !== BUILT_IN_ID && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${l.name}`}
                onClick={() => m.deleteList.mutate(l.id)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {lists.data && lists.data.invalid.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {lists.data.invalid.length} stored list(s) failed validation and were not used.
        </p>
      )}
      <ImportList />
    </section>
  )
}

function ImportList() {
  const settings = useLoadedSettings()
  const saveSettings = useSaveSettings()
  const m = useTokenMutations()
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState<string>()
  const [askOrigin, setAskOrigin] = useState<string>()
  // The list being fetched: the URL, and the ENS name when it was given as one
  const [target, setTarget] = useState<ListSource>()

  const store = (json: unknown, source: string, id: string) => {
    const parsed = parseTokenList(json)
    if (Either.isLeft(parsed)) return setMessage(parsed.left)
    const { name, tokens, skipped } = parsed.right
    // Each import reports its own outcome, even when another one starts before it finishes
    m.saveList
      .mutateAsync({
        id,
        name,
        source,
        enabled: true,
        tokens,
        importedAt: new Date().toISOString(),
      })
      .then(
        () =>
          setMessage(
            `Imported ${tokens.length} tokens from “${name}”${skipped ? `; skipped ${skipped} that are malformed or not EVM tokens` : ''}.`,
          ),
        (e: unknown) => setMessage(describeError(e)),
      )
  }
  const fromText = (t: string, source: string) => {
    let json: unknown
    try {
      json = JSON.parse(t)
    } catch {
      return setMessage('Not valid JSON.')
    }
    store(json, source, `${source}:${Date.now()}`)
  }
  const fetchList = async (t: ListSource) => {
    try {
      const res = await netguard.fetchFor('tokenlist')(t.url)
      if (!res.ok) {
        // eth.limo refuses requests whose Origin is localhost; deployed origins are fine
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
        return setMessage(
          t.ensName && res.status === 403 && local
            ? 'eth.limo answered HTTP 403: it refuses requests from a local development server (localhost). Importing by ENS name works from the deployed site.'
            : `${new URL(t.url).host} answered HTTP ${res.status}.`,
        )
      }
      const source = t.ensName ? `${t.ensName} (via eth.limo)` : t.url
      store(await res.json(), source, t.url)
    } catch (e) {
      setMessage(describeError(e))
    }
  }
  const startUrl = async () => {
    setMessage(undefined)
    const parsed = tokenListSource(url)
    if (Either.isLeft(parsed)) return setMessage(parsed.left)
    const origin = originOf(parsed.right.url)
    if (!origin) return setMessage('Not a valid URL.')
    setTarget(parsed.right)
    if (settings.capabilities.tokenListOrigins.includes(origin)) return fetchList(parsed.right)
    setAskOrigin(origin)
  }
  const once = async () => {
    if (!askOrigin || !target) return
    grantOrigin(askOrigin)
    try {
      await fetchList(target)
    } finally {
      revokeGrant(askOrigin)
      setAskOrigin(undefined)
    }
  }
  const always = () => {
    if (!askOrigin || !target) return
    const next = {
      ...settings,
      capabilities: {
        ...settings.capabilities,
        tokenListOrigins: [...settings.capabilities.tokenListOrigins, askOrigin],
      },
    }
    saveSettings.mutate(next, {
      onSuccess: () => {
        setAskOrigin(undefined)
        void fetchList(target)
      },
      onError: (e) => setMessage(describeError(e)),
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="font-medium">Import a list</h3>
      <Label htmlFor="list-json">Paste a Uniswap-format token list</Label>
      <textarea
        id="list-json"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rounded-lg border bg-background p-2 font-mono text-xs"
        spellCheck={false}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!text.trim()} onClick={() => fromText(text, 'pasted')}>
          Import pasted list
        </Button>
        <FileButton
          label="Import a file"
          onFile={(f) => f.text().then((t) => fromText(t, 'file'))}
        />
      </div>
      <Label htmlFor="list-url">Or by URL or ENS name</Label>
      <div className="flex gap-2">
        <Input
          id="list-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tokens.uniswap.org or tokenlist.aave.eth"
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void startUrl()}
          disabled={!url.trim()}
        >
          Fetch
        </Button>
      </div>
      {askOrigin && (
        <div
          className="flex flex-col gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40"
          data-testid="list-consent"
        >
          <p>
            This list is at <span className="font-mono">{new URL(askOrigin).host}</span>
            {target?.ensName && (
              <>
                {' '}
                (eth.limo serving what the ENS name{' '}
                <span className="font-mono">{target.ensName}</span> points to)
              </>
            )}
            . Fetching it contacts that host. Fetch it once, or always allow it?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void once()}>
              Fetch once
            </Button>
            <Button size="sm" variant="outline" onClick={always}>
              Always allow
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAskOrigin(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className="text-sm" data-testid="list-message">
          {message}
        </p>
      )}
    </div>
  )
}

function MyTokens() {
  const settings = useLoadedSettings()
  const mine = useMyTokens()
  const m = useTokenMutations()
  const [chainId, setChainId] = useState(settings.chains[0]?.id ?? 1)
  const [addressText, setAddressText] = useState('')
  const address = useResolvedAddress(chainId, addressText).address
  const add = m.addMine
  const exportList = () =>
    downloadJson(
      'plainsafe-my-tokens.tokenlist.json',
      exportTokenList('My tokens', mine.data?.tokens ?? []),
    )
  const chainName = useChainName()
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My tokens</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={exportList}
          disabled={!mine.data?.tokens.length}
        >
          <Download /> Export as a token list
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border empty:hidden">
        {mine.data?.tokens.map((t) => (
          <li key={`${t.chainId}:${t.address}`} className="flex items-center gap-3 p-3">
            <TokenMonogram symbol={t.symbol} />
            <div className="flex flex-1 flex-col">
              <span className="font-medium">{t.symbol}</span>
              <span className="text-xs text-muted-foreground">
                {chainName(t.chainId)} · {shortAddress(t.address)} · {t.decimals} decimals
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${t.symbol}`}
              onClick={() => m.removeMine.mutate({ chainId: t.chainId, address: t.address })}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <h3 className="font-medium">Add a token by address</h3>
        <Select
          aria-label="Chain"
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
        >
          {settings.chains.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <AddressField
          label="Token contract"
          chainId={chainId}
          value={addressText}
          onChange={setAddressText}
        />
        <p className="text-xs text-muted-foreground">
          Symbol and decimals are read from the token contract over your RPC.
        </p>
        {add.error && <p className="text-sm text-destructive">{describeError(add.error)}</p>}
        <Button
          size="sm"
          className="self-start"
          disabled={!address || add.isPending}
          onClick={() =>
            address && add.mutate({ chainId, address }, { onSuccess: () => setAddressText('') })
          }
        >
          Add token
        </Button>
      </div>
    </section>
  )
}

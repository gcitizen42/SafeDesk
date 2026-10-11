// Settings → Clear signing (SPEC §3.12, §7.2): imported descriptors, trusted auditors, and the
// pinned registry commit.
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FileButton } from '@/components/file-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { describeError } from '@/lib/errors'
import {
  useBundledRegistry,
  useDescriptorMutations,
  useUserDescriptors,
} from '@/queries/clear-signing'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'

export function ClearSigningSettings() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Clear signing</h2>
        <p className="text-sm text-muted-foreground">
          ERC-7730 descriptors turn calldata into plain language. They only change how a transaction
          is described: safety warnings always come from the decoded call itself.
        </p>
      </section>
      <ImportedDescriptors />
      <TrustedAuditors />
      <Registry />
    </div>
  )
}

function ImportedDescriptors() {
  const list = useUserDescriptors()
  const { add, remove } = useDescriptorMutations()
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium">Descriptors you imported</h3>
      <p className="text-sm text-muted-foreground">
        Imported descriptors apply to the contracts listed in their deployments and are always
        labeled "Clear signing, not reviewed". They're stored in this browser only.
      </p>
      {list.data?.invalid.length ? (
        <p className="text-sm text-destructive">
          {list.data.invalid.length} saved descriptor(s) are invalid and were not used.
        </p>
      ) : null}
      {list.data?.descriptors.length ? (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="user-descriptors">
          {list.data.descriptors.map((d) => {
            const deployments = d.descriptor.context.contract?.deployments ?? []
            return (
              <li key={d.id} className="flex items-center gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{d.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {deployments.length
                      ? deployments.map((x) => `${x.chainId}:${x.address}`).join(', ')
                      : 'no contract deployments (typed data only)'}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    SHA-256 {d.id.slice(0, 16)}…
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => remove.mutate(d.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None.</p>
      )}
      <FileButton
        className="self-start"
        label="Import a descriptor"
        onFile={(f) => add.mutate(f)}
      />
      {add.error && <p className="text-sm text-destructive">{describeError(add.error)}</p>}
    </section>
  )
}

function TrustedAuditors() {
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  const [text, setText] = useState('')
  const valid = /^eip155-\d+-0x[0-9a-fA-F]{40}$/.test(text.trim())
  const set = (trustedAuditors: readonly string[]) => save.mutate({ ...settings, trustedAuditors })
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium">Trusted auditors</h3>
      <p className="text-sm text-muted-foreground">
        ERC-8176 attestations from these auditors would mark a descriptor as reviewed. This build
        doesn't check attestations yet, so every descriptor is shown as not reviewed.
      </p>
      <ul className="flex flex-col divide-y rounded-lg border">
        {settings.trustedAuditors.map((a) => (
          <li key={a} className="flex items-center gap-3 p-3">
            <span className="flex-1 font-mono text-xs break-all">{a}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${a}`}
              onClick={() => set(settings.trustedAuditors.filter((x) => x !== a))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
        {settings.trustedAuditors.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">None.</li>
        )}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label="Auditor ID"
          placeholder="eip155-1-0x…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          disabled={!valid || settings.trustedAuditors.includes(text.trim())}
          onClick={() => {
            set([...settings.trustedAuditors, text.trim()])
            setText('')
          }}
        >
          Add
        </Button>
      </div>
    </section>
  )
}

function Registry() {
  const bundle = useBundledRegistry()
  return (
    <section className="flex flex-col gap-1 text-sm">
      <h3 className="font-medium">Registry</h3>
      {bundle.data && (
        <p className="text-muted-foreground">
          <span className="font-mono">{bundle.data.repo}</span> at commit{' '}
          <span className="font-mono">{bundle.data.commit}</span>. {bundle.data.files} files (Safe's
          descriptors and the auditor profiles) are bundled; others are downloaded only with
          "Clear-signing descriptors" on in Network access, and dropped unless their SHA-256
          matches.
        </p>
      )}
    </section>
  )
}

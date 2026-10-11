// The clear-signing rendering (SPEC §7.1 level 2, §7.2). Display only: the library's warnings
// are shown muted next to their field, never as safety banners (SPEC §7.4).
import {
  type DisplayField,
  type DisplayModel,
  isFieldGroup,
} from '@ethereum-sourcify/clear-signing'
import { getAddress, isAddress } from 'viem'
import { AddressView } from '@/components/address'
import type { ClearSigning, RenderSource } from '@/features/clear-signing/render'

const intentText = (d: DisplayModel): string | undefined =>
  typeof d.intent === 'string'
    ? d.intent
    : d.intent
      ? Object.entries(d.intent)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
      : undefined

function ClearSigningBadge() {
  return (
    <span
      data-testid="clear-signing-badge"
      className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
      title="Rendered from an ERC-7730 descriptor that no trusted auditor has reviewed"
    >
      Clear signing, not reviewed
    </span>
  )
}

export function ClearSigningView({ chainId, result }: { chainId: number; result: ClearSigning }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" data-testid="clear-signing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The SafeTx descriptor's own intent is just "Safe"; the inner call's shows below. */}
        <h2 className="font-medium">
          {result.via === 'call' ? (intentText(result.display) ?? 'Details') : 'Details'}
        </h2>
        <ClearSigningBadge />
      </div>
      <Fields chainId={chainId} display={result.display} />
      <Sources sources={result.sources} commit={result.registryCommit} />
    </section>
  )
}

// The library returns a fixed, ordered field list per rendering, so a position is a stable key.
const keyed = <T,>(list: readonly T[]) => list.map((item, i) => [`field-${i}`, item] as const)

function Fields({ chainId, display }: { chainId: number; display: DisplayModel }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      {keyed(display.fields ?? []).map(([key, f]) =>
        isFieldGroup(f) ? (
          <div key={key} className="col-span-2 flex flex-col gap-1">
            {f.label && <p className="text-muted-foreground">{f.label}</p>}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 border-l pl-3">
              {keyed(f.fields).map(([k, g]) => (
                <Field key={k} chainId={chainId} field={g} />
              ))}
            </dl>
            {f.warning && <Warning text={f.warning.message} />}
          </div>
        ) : (
          <Field key={key} chainId={chainId} field={f} />
        ),
      )}
    </dl>
  )
}

function Field({ chainId, field }: { chainId: number; field: DisplayField }) {
  const raw = field.rawAddress && isAddress(field.rawAddress) ? getAddress(field.rawAddress) : null
  const inner = field.embeddedCalldata
  return (
    <>
      {field.separator && (
        <p className="col-span-2 text-xs font-medium text-muted-foreground">{field.separator}</p>
      )}
      <dt className="text-muted-foreground">{field.label}</dt>
      <dd className="min-w-0 break-words">
        {inner && field.value === '0x' ? (
          <span>No calldata: a plain transfer</span>
        ) : inner ? (
          <Embedded chainId={chainId} inner={inner} />
        ) : raw ? (
          <span className="flex flex-col">
            <AddressView chainId={chainId} address={raw} />
            {field.value.toLowerCase() !== raw.toLowerCase() && (
              <span className="text-xs text-muted-foreground">{field.value}</span>
            )}
          </span>
        ) : (
          <span>{field.value}</span>
        )}
        {field.warning && !(raw && field.warning.code === 'UNKNOWN_ADDRESS') && (
          <Warning text={field.warning.message} />
        )}
      </dd>
    </>
  )
}

function Embedded({
  chainId,
  inner,
}: {
  chainId: number
  inner: NonNullable<DisplayField['embeddedCalldata']>
}) {
  const d = inner.display
  if (d.rawCalldataFallback || !d.fields?.length)
    return (
      <span className="text-muted-foreground">
        No descriptor covers this call; the ABI decoding describes it.
      </span>
    )
  return (
    <div className="flex flex-col gap-2 border-l pl-3">
      <p className="font-medium">{d.interpolatedIntent ?? intentText(d)}</p>
      {inner.callee && isAddress(inner.callee) && (
        <p className="text-xs text-muted-foreground">
          on <AddressView chainId={inner.chainId ?? chainId} address={getAddress(inner.callee)} />
        </p>
      )}
      <Fields chainId={inner.chainId ?? chainId} display={d} />
    </div>
  )
}

const Warning = ({ text }: { text: string }) => (
  <span className="block text-xs text-muted-foreground">Descriptor note: {text}</span>
)

const fileName = (path: string) => path.split('/').pop() ?? path

function sourceText(s: RenderSource, commit: string): string {
  switch (s.kind) {
    case 'bundled':
      return `${fileName(s.path)}, bundled with the app (registry commit ${commit.slice(0, 7)})`
    case 'registry':
      return `${fileName(s.path)}, downloaded from the registry at ${commit.slice(0, 7)} and SHA-256 checked`
    case 'user':
      return `${s.name}, user-supplied`
    case 'token-template':
      return 'the built-in ERC-20 template, for a token in your lists'
  }
}

function Sources({ sources, commit }: { sources: readonly RenderSource[]; commit: string }) {
  if (!sources.length) return null
  return (
    <div className="text-xs text-muted-foreground" data-testid="clear-signing-sources">
      <p>Descriptors used:</p>
      <ul className="list-disc pl-5">
        {sources.map((s) => (
          <li key={s.kind === 'user' ? s.id : s.kind === 'token-template' ? s.kind : s.path}>
            {sourceText(s, commit)}
          </li>
        ))}
      </ul>
    </div>
  )
}

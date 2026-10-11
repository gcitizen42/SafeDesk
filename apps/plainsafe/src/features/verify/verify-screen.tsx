// #/verify (SPEC §3.10): recompute a Safe transaction's hashes with no wallet and no RPC, from a
// shared package or from the individual fields. "Check against chain" is optional and saves
// nothing.
import { type ReactNode, useState } from 'react'
import { type Address, formatUnits } from 'viem'
import { Link } from 'wouter'
import { AddressView } from '@/components/address'
import { Callout } from '@/components/callout'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Decoded } from '@/core/decode'
import { describeCall, tokenLookup } from '@/core/describe'
import { decodeOffline, standardLabel } from '@/core/offline-decode'
import { classifySigners, SUPPORTED_PACKAGE_VERSIONS, type VerifiedPackage } from '@/core/package'
import { safeTxHashes } from '@/core/safe-tx'
import { WhatsabiChecks } from '@/features/review/checks'
import { ClearSigningView } from '@/features/review/clear-signing-view'
import { HashesPanel } from '@/features/review/hashes'
import { TxFields } from '@/features/review/tx-fields'
import { clearSigningSummary } from '@/features/review/tx-summary'
import { AuthenticityBadge } from '@/features/safes/authenticity-badge'
import { isSetupDone, useGoToSetup } from '@/features/setup/return-to'
import { PackageInput, ProposerNote } from '@/features/share/offline'
import { RouterCommands } from '@/features/swap/router-view'
import { describeError } from '@/lib/errors'
import { argText } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useClearSigningFor } from '@/queries/clear-signing'
import { useInspect } from '@/queries/contracts'
import { OfflineView } from '@/queries/offline'
import { useSafe } from '@/queries/safes'
import { useChain, useLoadedSettings, useNativeCurrency } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'
import type { PackageSignature } from '@/schemas/package'
import type { ChainSettings } from '@/schemas/settings'
import { emptyFields, type FieldValues, type Parsed, parseFields, toFields } from './fields'

type Mode = 'paste' | 'fields'

export function VerifyScreen() {
  const [mode, setMode] = useState<Mode>('paste')
  const [pkg, setPkg] = useState<VerifiedPackage>()
  const [fields, setFields] = useState<FieldValues>(emptyFields)
  const parsed = parseFields(fields)

  const fromPackage: Parsed | undefined = pkg && {
    chainId: pkg.pkg.chainId,
    safe: pkg.pkg.safe,
    version: pkg.pkg.safeVersion,
    tx: pkg.tx,
  }
  const current = mode === 'paste' ? fromPackage : parsed.ok ? parsed.value : undefined

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Verify a transaction</h1>
        <p className="text-sm text-muted-foreground">
          Recompute a Safe transaction's hashes in this browser, with no wallet and no RPC, and
          compare them with your wallet or hardware device screen. Nothing you enter is saved.
        </p>
      </div>
      <div className="flex gap-2" role="tablist">
        {(
          [
            ['paste', 'Link, code, JSON or file'],
            ['fields', 'Enter the fields'],
          ] as const
        ).map(([m, label]) => (
          <Button
            key={m}
            role="tab"
            aria-selected={mode === m}
            variant={mode === m ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(m)}
          >
            {label}
          </Button>
        ))}
      </div>

      {mode === 'paste' ? (
        <PackageInput action="Verify" onVerified={setPkg}>
          {fromPackage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFields(toFields(fromPackage))
                setMode('fields')
              }}
            >
              Edit these fields
            </Button>
          )}
        </PackageInput>
      ) : (
        <FieldsForm fields={fields} onChange={setFields} errors={parsed.ok ? {} : parsed.errors} />
      )}

      {current && (
        <VerifyResult
          key={`${current.chainId}:${current.safe}`}
          parsed={current}
          pkg={mode === 'paste' ? pkg : undefined}
        />
      )}
    </div>
  )
}

const GAS_AND_NONCE = [
  'safeTxGas',
  'baseGas',
  'gasPrice',
  'gasToken',
  'refundReceiver',
  'nonce',
] as const

function FieldsForm(props: {
  fields: FieldValues
  onChange: (f: FieldValues) => void
  errors: Partial<Record<keyof FieldValues, string>>
}) {
  const set = (k: keyof FieldValues, v: string) => props.onChange({ ...props.fields, [k]: v })
  const field = (k: keyof FieldValues, label: string, control: ReactNode, hint?: string) => (
    <div
      key={k}
      className={cn('flex flex-col gap-1', (k === 'to' || k === 'data') && 'sm:col-span-2')}
    >
      <Label htmlFor={`verify-${k}`}>
        {label}
        {hint && <span className="font-normal text-muted-foreground"> ({hint})</span>}
      </Label>
      {control}
      {props.errors[k] && <p className="text-xs text-destructive">{props.errors[k]}</p>}
    </div>
  )
  const input = (k: keyof FieldValues, label: string = k, hint?: string) =>
    field(
      k,
      label,
      <Input
        id={`verify-${k}`}
        value={props.fields[k]}
        onChange={(e) => set(k, e.target.value)}
        spellCheck={false}
        className="font-mono text-xs"
      />,
      hint,
    )
  const select = (k: 'version' | 'operation', label: string, options: [string, string][]) =>
    field(
      k,
      label,
      <Select id={`verify-${k}`} value={props.fields[k]} onChange={(e) => set(k, e.target.value)}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </Select>,
    )
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="verify-fields">
      {input('chainId', 'Chain ID')}
      {input('safe', 'Safe address')}
      {select(
        'version',
        'Safe version',
        [...SUPPORTED_PACKAGE_VERSIONS].map((v) => [v, `v${v}`]),
      )}
      {select('operation', 'operation', [
        ['0', '0 (call)'],
        ['1', '1 (delegatecall)'],
      ])}
      {input('to')}
      {input('value', 'value', 'in wei')}
      {field(
        'data',
        'data',
        <textarea
          id="verify-data"
          value={props.fields.data}
          onChange={(e) => set('data', e.target.value)}
          rows={3}
          spellCheck={false}
          className="rounded-lg border bg-background p-2 font-mono text-xs"
        />,
      )}
      {GAS_AND_NONCE.map((k) => input(k))}
    </div>
  )
}

function VerifyResult({ parsed, pkg }: { parsed: Parsed; pkg?: VerifiedPackage | undefined }) {
  const { chainId, safe, version, tx } = parsed
  const chain = useChain(chainId)
  const hashes = safeTxHashes(chainId, safe, tx)
  const decoded = decodeOffline(chainId, safe, tx, { label: standardLabel })
  // Offline: bundled and imported descriptors only, for the claimed version (SPEC §3.10, §7.1)
  const clear = useClearSigningFor({ chainId, safe, version, l2: false }, tx, hashes.safeTx, true)
  const currency = useNativeCurrency(chainId)
  // The token lists are local: no network, as the page promises (SPEC §3.10)
  const tokens = useTokenUniverse(chainId)
  const summary =
    clearSigningSummary(clear.data, tx, safe) ??
    describeCall(tx, decoded, safe, currency, tokenLookup(tokens))
  // No RPC reads until "Check against chain", not even ENS names for the addresses shown
  const [checked, setChecked] = useState(false)

  return (
    <OfflineView value={!checked}>
      <div className="flex flex-col gap-5" data-testid="verify-result">
        <section className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">
            {chain?.name ?? `Chain ${chainId}`} · claims Safe v{version} · nonce{' '}
            {tx.nonce.toString()}
          </p>
          <AddressView chainId={chainId} address={safe} full />
        </section>
        <h2 className="text-lg font-semibold" data-testid="verify-summary">
          {summary}
        </h2>
        {pkg?.pkg.note && <ProposerNote note={pkg.pkg.note} />}
        {tx.operation === 1 && (
          <Callout severity="red" title="Delegatecall">
            The target's code runs as the Safe itself, with full control over its funds, owners and
            modules. Only sign if the target is a contract you trust for this.
          </Callout>
        )}
        <HashesPanel hashes={hashes} />
        <OfflineDecoding
          chainId={chainId}
          safe={safe}
          decoded={decoded}
          tx={tx}
          currency={currency}
        />
        {clear.data && (
          <details className="rounded-lg border px-4 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Clear-signing view</summary>
            <div className="mt-3 mb-2">
              <ClearSigningView chainId={chainId} result={clear.data} />
            </div>
          </details>
        )}
        {pkg && <OfflineSignatures pkg={pkg} />}
        <TxFields chainId={chainId} tx={tx} />
        <ChainCheck
          parsed={parsed}
          chain={chain}
          signatures={pkg?.signatures ?? []}
          checked={checked}
          onCheck={() => setChecked(true)}
        />
      </div>
    </OfflineView>
  )
}

function OfflineDecoding({
  chainId,
  safe,
  decoded,
  tx,
  currency,
}: {
  chainId: number
  safe: Address
  decoded: Decoded
  tx: Parsed['tx']
  currency: { symbol: string; decimals: number }
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border p-4 text-sm"
      data-testid="verify-decoded"
    >
      <h2 className="font-medium">Calldata, decoded offline</h2>
      {decoded.kind === 'empty' && <p>No calldata: a plain value transfer.</p>}
      {decoded.kind === 'raw' && (
        <p>
          Can't be decoded offline with the bundled ABIs
          {decoded.selector ? ` (selector ${decoded.selector})` : ''}. Treat it as unverified.
        </p>
      )}
      {decoded.kind === 'router' && (
        <>
          <p>A Universal Router call, decoded offline by Plain Safe's own decoder:</p>
          <RouterCommands chainId={chainId} safe={safe} router={decoded.router} offline />
        </>
      )}
      {decoded.kind === 'abi' && (
        <>
          <p>
            <span className="font-mono text-xs">{decoded.signature}</span>, with the{' '}
            {decoded.source === 'Safe' ? 'Safe ABI' : decoded.source}; not checked against the
            target's bytecode until you check against the chain.
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {decoded.args.map((a) => (
              <div key={a.name} className="contents">
                <dt className="text-muted-foreground">
                  {a.name} <span className="font-mono text-xs">{a.type}</span>
                </dt>
                <dd className="font-mono text-xs break-all">
                  {a.type === 'address' && typeof a.value === 'string' ? (
                    <AddressView chainId={chainId} address={a.value} full />
                  ) : (
                    argText(a.value)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {tx.value > 0n && decoded.kind !== 'empty' && (
        <p className="text-muted-foreground">
          Also sends {formatUnits(tx.value, currency.decimals)} {currency.symbol}.
        </p>
      )}
    </section>
  )
}

function OfflineSignatures({ pkg }: { pkg: VerifiedPackage }) {
  return (
    <section
      className="flex flex-col gap-1 rounded-lg border p-4 text-sm"
      data-testid="verify-signers"
    >
      <h2 className="font-medium">Signatures ({pkg.signatures.length})</h2>
      {pkg.signatures.length === 0 && <p className="text-muted-foreground">None yet.</p>}
      {pkg.signatures.map((s) => (
        <p key={s.signer}>
          Signed by <span className="font-mono">{s.signer}</span> (recovered from the signature)
        </p>
      ))}
      {pkg.rejected.map((r) => (
        <p key={r.signer} className="text-destructive">
          Rejected signature claimed by {r.signer}: {r.reason}.
        </p>
      ))}
    </section>
  )
}

/** Optional (SPEC §3.10): the authenticity check, owners and nonce, over the configured RPC. */
function ChainCheck({
  parsed,
  chain,
  signatures,
  checked,
  onCheck,
}: {
  parsed: Parsed
  chain: ChainSettings | undefined
  signatures: readonly PackageSignature[]
  checked: boolean
  onCheck: () => void
}) {
  const settings = useLoadedSettings()
  const goToSetup = useGoToSetup()

  if (!isSetupDone(settings))
    return (
      <p className="text-sm text-muted-foreground">
        To check this against the chain, first{' '}
        <button type="button" className="underline underline-offset-2" onClick={goToSetup}>
          set up an RPC
        </button>
        . What you entered here isn't kept.
      </p>
    )
  if (!chain)
    return (
      <p className="text-sm text-muted-foreground">
        Chain {parsed.chainId} isn't set up. Add it in{' '}
        <Link href="/settings/rpcs" className="underline underline-offset-2">
          Settings
        </Link>{' '}
        to check this against the chain.
      </p>
    )
  if (!checked)
    return (
      <Button variant="outline" className="self-start" onClick={onCheck}>
        Check against chain
      </Button>
    )
  return <ChainResult parsed={parsed} chain={chain} signatures={signatures} />
}

function ChainResult({
  parsed,
  chain,
  signatures,
}: {
  parsed: Parsed
  chain: ChainSettings
  signatures: readonly PackageSignature[]
}) {
  const { chainId, safe, version, tx } = parsed
  const snapshot = useSafe(chainId, safe, { fresh: true })
  const inspection = useInspect(chainId, tx.to)
  const s = snapshot.data
  const a = s?.authenticity
  const owners = classifySigners(signatures, s?.owners)
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4 text-sm"
      data-testid="verify-chain"
    >
      <h2 className="font-medium">Checked against {chain.name}</h2>
      {snapshot.isPending && <p className="text-muted-foreground">Reading the Safe…</p>}
      {snapshot.error && <p className="text-destructive">{describeError(snapshot.error)}</p>}
      {s && a && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <AuthenticityBadge authenticity={a} />
            <span className="text-muted-foreground">as of block {s.block.toString()}</span>
          </div>
          {a.status === 'verified' && a.version !== version && (
            <p>
              The input claims v{version}, but the code is v{a.version}. The hashes are the same for
              every version from 1.3.0 on.
            </p>
          )}
          {s.nonce !== undefined && (
            <p data-testid="verify-nonce">
              {tx.nonce < s.nonce
                ? `Nonce ${tx.nonce} was already used (the Safe is at ${s.nonce}). This transaction can't be executed.`
                : tx.nonce === s.nonce
                  ? `Nonce ${tx.nonce} is the Safe's next nonce.`
                  : `Nonce ${tx.nonce} is ${tx.nonce - s.nonce} ahead of the Safe's next nonce (${s.nonce}).`}
            </p>
          )}
          {s.threshold !== undefined && signatures.length > 0 && (
            <p data-testid="verify-owners">
              {owners.owners.length} of the {signatures.length} signers{' '}
              {owners.owners.length === 1 ? 'is a' : 'are'} current owner
              {owners.owners.length === 1 ? '' : 's'}; the threshold is {s.threshold.toString()}.
              {owners.nonOwners.length > 0 &&
                ` Not owners: ${owners.nonOwners.map((x) => x.signer).join(', ')}.`}
            </p>
          )}
        </>
      )}
      {inspection.error && <p className="text-destructive">{describeError(inspection.error)}</p>}
      {inspection.data && <WhatsabiChecks tx={tx} inspection={inspection.data} />}
    </section>
  )
}

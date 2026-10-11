// Decoded fields at their trust level (SPEC §7.1), with raw fields folded away elsewhere.
import { type Address, formatUnits, getAddress, isAddress } from 'viem'
import { AddressView } from '@/components/address'
import { applyOwnerChange, type OwnerChange } from '@/core/builders'
import type { Decoded, Guess } from '@/core/decode'
import type { BatchCall } from '@/core/multisend'
import type { SafeTx } from '@/core/safe-tx'
import { OwnerDiff } from '@/features/builder/presets'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { RouterCommands } from '@/features/swap/router-view'
import { argText } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTokenMeta } from '@/queries/contracts'
import { useChain } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'

function TrustBadge({ decoded, guess }: { decoded: Decoded; guess?: Guess | undefined }) {
  const [text, tone] =
    decoded.kind === 'empty'
      ? ['No calldata: value transfer', 'ok']
      : decoded.kind === 'abi' || decoded.kind === 'router'
        ? [`Decoded (${decoded.source})`, 'ok']
        : decoded.kind === 'batch'
          ? [`Batch of ${decoded.calls.length} (${decoded.source})`, 'ok']
          : guess
            ? ['Guessed (possible selector collision)', 'warn']
            : ['Unverified: raw calldata', 'warn']
  return (
    <span
      data-testid="trust-badge"
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'ok'
          ? 'bg-muted text-foreground'
          : 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100',
      )}
    >
      {text}
    </span>
  )
}

function ownerChangeOf(decoded: Decoded): OwnerChange | undefined {
  if (decoded.kind !== 'abi' || decoded.source !== 'Safe') return undefined
  const v = decoded.args.map((a) => a.value)
  switch (decoded.functionName) {
    case 'addOwnerWithThreshold':
      return { kind: 'add', owner: v[0] as Address, threshold: v[1] as bigint }
    case 'removeOwner':
      return { kind: 'remove', owner: v[1] as Address, threshold: v[2] as bigint }
    case 'swapOwner':
      return { kind: 'swap', oldOwner: v[1] as Address, newOwner: v[2] as Address }
    case 'changeThreshold':
      return { kind: 'threshold', threshold: v[0] as bigint }
  }
  return undefined
}

export function DecodedView({
  chainId,
  tx,
  decoded,
  guess,
  safe,
}: {
  chainId: number
  tx: SafeTx
  decoded: Decoded
  /** Level 4 (SPEC §7.1), shown only when nothing better decodes the call. */
  guess?: Guess | undefined
  safe?: SafeSnapshot | undefined
}) {
  const change = ownerChangeOf(decoded)
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" data-testid="details">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Details</h2>
        <TrustBadge decoded={decoded} guess={guess} />
      </div>
      {decoded.kind === 'batch' ? (
        <BatchCalls chainId={chainId} tx={tx} decoded={decoded} safe={safe} />
      ) : (
        <CallRows
          chainId={chainId}
          call={tx}
          decoded={decoded}
          guess={guess}
          safe={safe?.address}
        />
      )}
      {change && safe?.owners && safe.threshold !== undefined && (
        <OwnerDiff
          chainId={chainId}
          before={{ owners: safe.owners, threshold: safe.threshold }}
          after={applyOwnerChange(safe.owners, safe.threshold, change)}
        />
      )}
    </section>
  )
}

/** Each call of a batch at its own trust level; owner changes shown as they build up. */
function BatchCalls({
  chainId,
  tx,
  decoded,
  safe,
}: {
  chainId: number
  tx: SafeTx
  decoded: Extract<Decoded, { kind: 'batch' }>
  safe?: SafeSnapshot | undefined
}) {
  let state =
    safe?.owners && safe.threshold !== undefined
      ? { owners: safe.owners, threshold: safe.threshold }
      : undefined
  const items = decoded.calls.map(({ call, decoded: inner }, i) => {
    const change =
      safe && call.to.toLowerCase() === safe.address.toLowerCase()
        ? ownerChangeOf(inner)
        : undefined
    const before = state
    const after =
      change && before ? applyOwnerChange(before.owners, before.threshold, change) : undefined
    if (after) state = after
    return { key: i, call, inner, before, after }
  })
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="flex flex-wrap items-center gap-1">
        Delegatecall to <AddressView chainId={chainId} address={tx.to} />
      </p>
      <p>
        {decoded.source}, verified by code hash, makes these {decoded.calls.length} calls in order,
        as the Safe:
      </p>
      <ol className="flex flex-col gap-2" data-testid="batch-calls">
        {items.map(({ key, call, inner, before, after }) => (
          <li key={key} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Call {key + 1}</span>
              <TrustBadge decoded={inner} />
            </div>
            <CallRows chainId={chainId} call={call} decoded={inner} safe={safe?.address} />
            {before && after && <OwnerDiff chainId={chainId} before={before} after={after} />}
          </li>
        ))}
      </ol>
    </div>
  )
}

function CallRows({
  chainId,
  call,
  decoded,
  guess,
  safe,
}: {
  chainId: number
  call: BatchCall
  decoded: Decoded
  guess?: Guess | undefined
  /** For labeling recipients relative to this Safe. */
  safe?: Address | undefined
}) {
  const currency = useChain(chainId)?.nativeCurrency
  const erc20 =
    decoded.kind === 'abi' &&
    decoded.source.startsWith('ERC-20') &&
    ['transfer', 'approve', 'transferFrom'].includes(decoded.functionName)
  const universe = useTokenUniverse(chainId)
  const listed = erc20
    ? universe?.find((t) => t.address.toLowerCase() === call.to.toLowerCase())
    : undefined
  const meta = useTokenMeta(chainId, erc20 && universe && !listed ? call.to : undefined)
  const token = listed
    ? { symbol: listed.symbol, decimals: listed.decimals, source: `from ${listed.source}` }
    : meta.data
      ? {
          symbol: meta.data.symbol,
          decimals: meta.data.decimals,
          source: 'not in your lists; read from the token contract',
        }
      : undefined
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{call.operation === 1 ? 'Delegatecall to' : 'To'}</dt>
      <dd>
        <AddressView chainId={chainId} address={call.to} />
      </dd>
      {(call.value > 0n || decoded.kind === 'empty') && (
        <>
          <dt className="text-muted-foreground">Value</dt>
          <dd>
            {currency
              ? `${formatUnits(call.value, currency.decimals)} ${currency.symbol}`
              : call.value.toString()}
          </dd>
        </>
      )}
      {decoded.kind === 'abi' && (
        <>
          <dt className="text-muted-foreground">Function</dt>
          <dd className="font-mono text-xs break-all">{decoded.signature}</dd>
          {decoded.args.map((a) => (
            <ArgRow
              key={a.name}
              chainId={chainId}
              name={a.name}
              type={a.type}
              value={a.value}
              amount={
                erc20 && a.type === 'uint256' && token
                  ? `${formatUnits(a.value as bigint, token.decimals)} ${token.symbol} (symbol ${token.source})`
                  : undefined
              }
            />
          ))}
          {decoded.inner && (
            <>
              <dt className="text-muted-foreground">Its calls</dt>
              <dd className="min-w-0">
                <ol className="flex flex-col gap-2" data-testid="multicall-calls">
                  {decoded.inner.map((c, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: calls have no identity but their place
                    <li key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">Call {i + 1}, on the same contract</span>
                        <TrustBadge decoded={c.decoded} />
                      </div>
                      <CallRows
                        chainId={chainId}
                        call={{ to: call.to, value: 0n, data: c.data, operation: 0 }}
                        decoded={c.decoded}
                        safe={safe}
                      />
                    </li>
                  ))}
                </ol>
              </dd>
            </>
          )}
        </>
      )}
      {decoded.kind === 'router' && (
        <>
          <dt className="text-muted-foreground">Function</dt>
          <dd className="font-mono text-xs">execute(bytes,bytes[],uint256)</dd>
          <dt className="text-muted-foreground">Commands</dt>
          <dd>
            <RouterCommands chainId={chainId} safe={safe} router={decoded.router} />
          </dd>
        </>
      )}
      {decoded.kind === 'raw' && guess && (
        <>
          <dt className="text-muted-foreground">Guessed function</dt>
          <dd className="flex flex-col gap-0.5">
            <span className="font-mono text-xs">{guess.signature}</span>
            <span className="text-xs text-muted-foreground">
              From the signature database, where anyone can register a name for a selector. Not
              verified against this contract.
              {guess.alternatives.length > 0 &&
                ` Other names that also fit: ${guess.alternatives.join(', ')}.`}
            </span>
          </dd>
          {guess.args.map((a) => (
            <ArgRow key={a.name} chainId={chainId} name={a.name} type={a.type} value={a.value} />
          ))}
        </>
      )}
      {decoded.kind === 'raw' && (
        <>
          <dt className="text-muted-foreground">Selector</dt>
          <dd className="font-mono text-xs">{decoded.selector ?? '(none)'}</dd>
          <dt className="text-muted-foreground">Calldata</dt>
          <dd className="font-mono text-xs break-all">{call.data}</dd>
        </>
      )}
    </dl>
  )
}

function ArgRow(props: {
  chainId: number
  name: string
  type: string
  value: unknown
  amount?: string | undefined
}) {
  return (
    <>
      <dt className="text-muted-foreground">
        {props.name} <span className="font-mono text-xs">{props.type}</span>
      </dt>
      <dd className="break-all">
        {props.type === 'address' && typeof props.value === 'string' && isAddress(props.value) ? (
          <AddressView chainId={props.chainId} address={getAddress(props.value)} />
        ) : (
          <span className="font-mono text-xs">{argText(props.value)}</span>
        )}
        {props.amount && <span className="block text-muted-foreground">{props.amount}</span>}
      </dd>
    </>
  )
}

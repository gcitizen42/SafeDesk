// The builder presets' forms (SPEC §3.3). Each reports a call (or undefined while invalid).
import { useEffect, useMemo, useState } from 'react'
import { type Address, formatUnits, getAddress } from 'viem'
import { AddressView } from '@/components/address'
import { AddressField, AmountField, parseAmount } from '@/components/inputs'
import { Select } from '@/components/select'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  applyOwnerChange,
  type OwnerChange,
  ownerChangeCall,
  ownerChangeProblem,
  sendErc20,
  sendNative,
  type TxCall,
} from '@/core/builders'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import type { TokenInfo } from '@/features/tokens/store'
import { describeError } from '@/lib/errors'
import { jsonWithBigints, shortAddress } from '@/lib/format'
import { useTokenMeta } from '@/queries/contracts'
import { useResolvedAddress } from '@/queries/ens'
import { useNativeCurrency } from '@/queries/settings'
import { useBalances, useTokenUniverse } from '@/queries/tokens'

export interface BuiltCall {
  readonly call: TxCall
  readonly description: string
}

export interface PresetProps {
  readonly safe: SafeSnapshot
  readonly onResult: (r: BuiltCall | undefined) => void
}

/** Report the result whenever it changes (compared by content). */
export function useReport(result: BuiltCall | undefined, onResult: PresetProps['onResult']) {
  const key = result ? jsonWithBigints(result) : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures `result`
  useEffect(() => onResult(result), [key])
}

export function SendNative({ safe, onResult }: PresetProps) {
  const currency = useNativeCurrency(safe.chainId)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const recipient = useResolvedAddress(safe.chainId, to).address
  const value = parseAmount(amount, currency.decimals)
  const result =
    recipient && value !== undefined
      ? {
          call: sendNative(recipient, value),
          description: `Send ${formatUnits(value, currency.decimals)} ${currency.symbol} to ${shortAddress(recipient)}`,
        }
      : undefined
  useReport(result, onResult)
  return (
    <div className="flex flex-col gap-4">
      <AddressField label="Recipient" chainId={safe.chainId} value={to} onChange={setTo} />
      <AmountField
        label="Amount"
        value={amount}
        onChange={setAmount}
        decimals={currency.decimals}
        symbol={currency.symbol}
        max={safe.balance}
      />
    </div>
  )
}

/** The token pickers' "Other token (by address)…" choice. */
export const OTHER = 'other'
/** The source of a picked token that isn't in your lists. */
export const FROM_CONTRACT = 'the token contract'

/**
 * The token a picker names: a listed token's address, or OTHER with an address (or ENS name) in
 * `text`. A typed address that's in your lists uses the list's entry; any other gets its symbol
 * and decimals from the token contract.
 */
export function usePickedToken(chainId: number, choice: string, text: string) {
  const universe = useTokenUniverse(chainId)
  const typed = useResolvedAddress(chainId, text).address
  const address = choice === OTHER ? typed : choice
  const listed = address
    ? universe?.find((t) => t.address.toLowerCase() === address.toLowerCase())
    : undefined
  const meta = useTokenMeta(chainId, choice === OTHER && !listed ? typed : undefined)
  const token: TokenInfo | undefined =
    listed ??
    (meta.data && { ...meta.data, name: meta.data.name ?? '', source: FROM_CONTRACT, chainId })
  return { token, meta }
}

export function SendErc20({ safe, onResult }: PresetProps) {
  const universe = useTokenUniverse(safe.chainId)
  const balances = useBalances(safe.chainId, safe.address)
  const [choice, setChoice] = useState('')
  const [tokenText, setTokenText] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const { token, meta } = usePickedToken(safe.chainId, choice, tokenText)
  // Lists can hold thousands of tokens: balances are looked up by address, and sorted only when
  // the lists or balances change.
  const balanceOf = useMemo(
    () => new Map(balances.data?.tokens.map((b) => [b.token.address.toLowerCase(), b.balance])),
    [balances.data],
  )
  const withBalance = useMemo(
    () =>
      (universe ?? [])
        .map((t) => ({ t, b: balanceOf.get(t.address.toLowerCase()) ?? 0n }))
        .sort((x, y) => (y.b > x.b ? 1 : y.b < x.b ? -1 : x.t.symbol.localeCompare(y.t.symbol))),
    [universe, balanceOf],
  )
  const held = token ? balanceOf.get(token.address.toLowerCase()) : undefined
  const recipient = useResolvedAddress(safe.chainId, to).address
  const value = token ? parseAmount(amount, token.decimals) : undefined
  const result =
    token && recipient && value !== undefined
      ? {
          call: sendErc20(token.address, recipient, value),
          description: `Send ${formatUnits(value, token.decimals)} ${token.symbol} to ${shortAddress(recipient)}`,
        }
      : undefined
  useReport(result, onResult)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="token">Token</Label>
        <Select id="token" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a token…</option>
          {withBalance.map(({ t, b }) => (
            <option key={t.address} value={t.address}>
              {t.symbol} · {shortAddress(t.address)} · {formatUnits(b, t.decimals)} · from{' '}
              {t.source}
            </option>
          ))}
          <option value={OTHER}>Other token (by address)…</option>
        </Select>
      </div>
      {choice === OTHER && (
        <AddressField
          label="Token contract"
          chainId={safe.chainId}
          value={tokenText}
          onChange={setTokenText}
        />
      )}
      {meta.isLoading && <p className="text-sm text-muted-foreground">Reading the token…</p>}
      {meta.error && <p className="text-sm text-destructive">{describeError(meta.error)}</p>}
      {token && <TokenSource token={token} />}
      <AddressField label="Recipient" chainId={safe.chainId} value={to} onChange={setTo} />
      {token && (
        <AmountField
          label="Amount"
          value={amount}
          onChange={setAmount}
          decimals={token.decimals}
          symbol={token.symbol}
          max={held}
        />
      )}
    </div>
  )
}

/** Where a token's symbol and decimals came from: tokens are identified by address (SPEC §10). */
export function TokenSource({ token }: { token: TokenInfo }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid="token-source">
      {token.symbol}, {token.decimals} decimals, from {token.source}
      {token.source === FROM_CONTRACT &&
        ' (not in your lists). It is identified by its address, not its symbol'}
      .
    </p>
  )
}

type OwnerAction = OwnerChange['kind']

export function OwnersAndThreshold({ safe, onResult }: PresetProps) {
  const owners = safe.owners ?? []
  const threshold = safe.threshold ?? 1n
  const [action, setAction] = useState<OwnerAction>('add')
  const [newOwner, setNewOwner] = useState('')
  const [target, setTarget] = useState<string>(owners[0] ?? '')
  const [newThreshold, setNewThreshold] = useState(threshold.toString())

  const ownerCountAfter =
    action === 'add' ? owners.length + 1 : action === 'remove' ? owners.length - 1 : owners.length
  // A threshold picked for another action can be above this one's options: cap it, so the value
  // used is the one the select shows. (A select whose value matches no option shows its first
  // one, and choosing that fires no change, so e.g. removing an owner of a 2-of-2 was stuck.)
  const maxThreshold = Math.max(ownerCountAfter, 1)
  const t = BigInt(Math.min(Number(newThreshold), maxThreshold))
  const fresh = useResolvedAddress(safe.chainId, newOwner).address
  const change: OwnerChange | undefined = (() => {
    switch (action) {
      case 'add':
        return fresh ? { kind: 'add', owner: fresh, threshold: t } : undefined
      case 'remove':
        return target ? { kind: 'remove', owner: target as Address, threshold: t } : undefined
      case 'swap':
        return target && fresh
          ? { kind: 'swap', oldOwner: target as Address, newOwner: fresh }
          : undefined
      case 'threshold':
        return { kind: 'threshold', threshold: t }
    }
  })()
  const problem = change ? ownerChangeProblem(safe.address, owners, threshold, change) : undefined
  const after = change && !problem ? applyOwnerChange(owners, threshold, change) : undefined
  const describe = (c: OwnerChange) => {
    switch (c.kind) {
      case 'add':
        return `Add owner ${shortAddress(c.owner)} and set threshold to ${c.threshold}`
      case 'remove':
        return `Remove owner ${shortAddress(c.owner)} and set threshold to ${c.threshold}`
      case 'swap':
        return `Replace owner ${shortAddress(c.oldOwner)} with ${shortAddress(c.newOwner)}`
      case 'threshold':
        return `Change threshold to ${c.threshold}`
    }
  }
  const result =
    change && !problem
      ? { call: ownerChangeCall(safe.address, owners, change), description: describe(change) }
      : undefined
  useReport(result, onResult)

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={action}
        onValueChange={(v) => setAction(v as OwnerAction)}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(
          [
            ['add', 'Add an owner'],
            ['remove', 'Remove an owner'],
            ['swap', 'Replace an owner'],
            ['threshold', 'Change the threshold'],
          ] as const
        ).map(([value, label]) => (
          <Label key={value} className="flex items-center gap-2 font-normal">
            <RadioGroupItem value={value} /> {label}
          </Label>
        ))}
      </RadioGroup>
      {(action === 'remove' || action === 'swap') && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-select">
            {action === 'remove' ? 'Owner to remove' : 'Owner to replace'}
          </Label>
          <Select
            id="owner-select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="font-mono"
          >
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </div>
      )}
      {(action === 'add' || action === 'swap') && (
        <AddressField
          label="New owner"
          chainId={safe.chainId}
          value={newOwner}
          onChange={setNewOwner}
        />
      )}
      {action !== 'swap' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="threshold">New threshold (of {ownerCountAfter} owners)</Label>
          <Select
            id="threshold"
            value={t.toString()}
            onChange={(e) => setNewThreshold(e.target.value)}
            className="w-32"
          >
            {Array.from({ length: maxThreshold }, (_, i) => String(i + 1)).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
      )}
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      {after && <OwnerDiff chainId={safe.chainId} before={{ owners, threshold }} after={after} />}
    </div>
  )
}

/** Before → after view of owners and threshold (SPEC §7.4 orange rule). */
export function OwnerDiff(props: {
  chainId: number
  before: { owners: readonly Address[]; threshold: bigint }
  after: { owners: readonly Address[]; threshold: bigint }
}) {
  const had = new Set(props.before.owners.map((o) => o.toLowerCase()))
  const has = new Set(props.after.owners.map((o) => o.toLowerCase()))
  const all = [
    ...props.before.owners,
    ...props.after.owners.filter((o) => !had.has(o.toLowerCase())),
  ]
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/40"
      data-testid="owner-diff"
    >
      <p className="font-medium">
        Threshold: {props.before.threshold.toString()} of {props.before.owners.length} →{' '}
        {props.after.threshold.toString()} of {props.after.owners.length}
      </p>
      <ul className="flex flex-col gap-1">
        {all.map((o) => {
          const removed = !has.has(o.toLowerCase())
          const added = !had.has(o.toLowerCase())
          return (
            <li key={o} className="flex items-center gap-2">
              <span
                className={
                  removed
                    ? 'w-16 text-red-700 dark:text-red-400'
                    : added
                      ? 'w-16 text-emerald-700 dark:text-emerald-400'
                      : 'w-16 text-muted-foreground'
                }
              >
                {removed ? 'removed' : added ? 'added' : 'stays'}
              </span>
              <AddressView chainId={props.chainId} address={getAddress(o)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

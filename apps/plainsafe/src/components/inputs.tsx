// Inputs that validate as you type. The value handed back is only ever an address, never a name.
import { useId } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { looksLikeEnsName, useResolvedAddress } from '@/queries/ens'
import { useLabelOf } from '@/queries/safes'

/**
 * An address input that also accepts ENS names (SPEC §8.5). The resolved address is shown
 * prominently; parents read the value with useResolvedAddress and store only the address.
 */
export function AddressField(props: {
  label: string
  chainId: number
  value: string
  onChange: (v: string) => void
  problem?: string | undefined
}) {
  const id = useId()
  const labelOf = useLabelOf()
  const resolved = useResolvedAddress(props.chainId, props.value)
  const address = resolved.address
  const known = address && labelOf(props.chainId, address)
  const invalid = props.value.trim() !== '' && !address && !looksLikeEnsName(props.value)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="0x… or name.eth"
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-sm"
        aria-invalid={invalid || !!props.problem || !!resolved.error}
      />
      {invalid && (
        <p className="text-sm text-destructive">
          Not a valid address (check the checksum if it has mixed case) or ENS name.
        </p>
      )}
      {resolved.pending && (
        <p className="text-sm text-muted-foreground">Resolving {props.value.trim()}…</p>
      )}
      {resolved.error && <p className="text-sm text-destructive">{resolved.error}</p>}
      {resolved.name && address && (
        <p className="text-sm" data-testid="ens-resolved">
          {resolved.name} → <span className="font-mono font-semibold break-all">{address}</span>
        </p>
      )}
      {props.problem && <p className="text-sm text-destructive">{props.problem}</p>}
      {known && <p className="text-sm text-muted-foreground">In your address book as “{known}”.</p>}
    </div>
  )
}

export function parseAmount(text: string, decimals: number): bigint | undefined {
  const t = text.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined
  const [, frac = ''] = t.split('.')
  if (frac.length > decimals) return undefined
  return parseUnits(t, decimals)
}

export function AmountField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  decimals: number
  symbol: string
  max?: bigint | undefined
}) {
  const id = useId()
  const parsed = parseAmount(props.value, props.decimals)
  const invalid = props.value.trim() !== '' && parsed === undefined
  const over = parsed !== undefined && props.max !== undefined && parsed > props.max
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={props.value}
          inputMode="decimal"
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="0.0"
          aria-invalid={invalid}
          className="font-mono"
        />
        <span className="text-sm text-muted-foreground">{props.symbol}</span>
      </div>
      {invalid && (
        <p className="text-sm text-destructive">
          Enter a number with at most {props.decimals} decimals.
        </p>
      )}
      {props.max !== undefined && (
        <p
          className={
            over ? 'text-sm text-amber-700 dark:text-amber-400' : 'text-sm text-muted-foreground'
          }
        >
          {over ? 'More than the Safe holds now: ' : 'Available: '}
          {formatUnits(props.max, props.decimals)} {props.symbol}
        </p>
      )}
    </div>
  )
}

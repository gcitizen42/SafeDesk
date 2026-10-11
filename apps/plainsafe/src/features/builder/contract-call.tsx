// Contract call preset (SPEC §3.3, §7.3): whatsabi reads the target's bytecode over the RPC,
// follows proxies, and lists functions from a known ABI whose selectors are in that bytecode.
import { Schema } from 'effect'
import { useMemo, useState } from 'react'
import {
  type AbiFunction,
  encodeFunctionData,
  formatUnits,
  type Hex,
  isHex,
  slice,
  toFunctionSelector,
} from 'viem'
import { AddressField, AmountField, parseAmount } from '@/components/inputs'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ArgError, argPlaceholder, parseArg } from '@/core/abi-args'
import { contractCall } from '@/core/builders'
import { knownAbis } from '@/core/known-abis'
import type { ContractInspection } from '@/features/abi/inspect'
import type { SourcifyAbi } from '@/features/abi/remote'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useInspect, useSaveAbi, useSavedAbi, useSourcifyAbi } from '@/queries/contracts'
import { useResolvedAddress } from '@/queries/ens'
import { useNativeCurrency } from '@/queries/settings'
import { Abi } from '@/schemas/abi'
import { type BuiltCall, type PresetProps, useReport } from './presets'

interface FunctionOption {
  /** The function's selector. */
  readonly key: string
  readonly source: string
  readonly fn: AbiFunction
}

const signature = (fn: AbiFunction) => `${fn.name}(${fn.inputs.map((i) => i.type).join(',')})`

function functionOptions(
  inspection: ContractInspection,
  saved: readonly unknown[] | undefined,
  sourcify: SourcifyAbi | null | undefined,
): { options: FunctionOption[]; hidden: number } {
  const present = new Set(inspection.selectors.map((s) => s.toLowerCase()))
  const out = new Map<string, FunctionOption>()
  let hidden = 0
  const add = (source: string, items: readonly unknown[]) => {
    for (const item of items as readonly AbiFunction[]) {
      if (
        item.type !== 'function' ||
        item.stateMutability === 'view' ||
        item.stateMutability === 'pure'
      )
        continue
      const selector = toFunctionSelector(item)
      if (!present.has(selector)) {
        if (source === 'Your ABI library') hidden++
        continue
      }
      if (!out.has(selector)) out.set(selector, { key: selector, source, fn: item })
    }
  }
  // SPEC §3.3: the bundled set, then your ABI library, then Sourcify (when enabled)
  for (const k of knownAbis) add(k.name, k.abi)
  if (saved) add('Your ABI library', saved)
  if (sourcify) add(`Sourcify${sourcify.name ? ` (${sourcify.name})` : ''}`, sourcify.abi)
  return { options: [...out.values()].sort((a, b) => a.fn.name.localeCompare(b.fn.name)), hidden }
}

export function ContractCall({ safe, onResult }: PresetProps) {
  const currency = useNativeCurrency(safe.chainId)
  const [targetText, setTargetText] = useState('')
  const target = useResolvedAddress(safe.chainId, targetText).address
  const inspection = useInspect(safe.chainId, target)
  const saved = useSavedAbi(safe.chainId, inspection.data?.implementationCodeHash)
  const sourcify = useSourcifyAbi(safe.chainId, inspection.data)
  const [mode, setMode] = useState<'function' | 'raw'>('function')
  const [selected, setSelected] = useState('')
  const [args, setArgs] = useState<Record<string, string>>({})
  const [raw, setRaw] = useState('')
  const [valueText, setValueText] = useState('0')

  const { options, hidden } = useMemo(
    () =>
      inspection.data
        ? functionOptions(inspection.data, saved.data?.abi, sourcify.data)
        : { options: [], hidden: 0 },
    [inspection.data, saved.data, sourcify.data],
  )
  const option = options.find((o) => o.key === selected) ?? options[0]
  const value = parseAmount(valueText, currency.decimals)

  let data: Hex | undefined
  let argError: string | undefined
  if (mode === 'function' && option) {
    try {
      const values = option.fn.inputs.map((p, i) =>
        parseArg(p, args[`${option.key}:${i}`] ?? '', p.name || `arg ${i + 1}`),
      )
      data = encodeFunctionData({ abi: [option.fn], functionName: option.fn.name, args: values })
    } catch (e) {
      argError = e instanceof ArgError ? e.message : 'Fill in every field.'
    }
  }
  if (mode === 'raw') {
    const t = raw.trim()
    data = isHex(t) && t.length % 2 === 0 ? t : undefined
  }
  const notPayable =
    mode === 'function' &&
    option &&
    option.fn.stateMutability !== 'payable' &&
    value !== undefined &&
    value > 0n

  const result: BuiltCall | undefined =
    target && data !== undefined && value !== undefined && !notPayable
      ? {
          call: contractCall(target, value, data),
          description:
            mode === 'function' && option
              ? `Call ${option.fn.name} on ${shortAddress(target)}${value > 0n ? ` with ${formatUnits(value, currency.decimals)} ${currency.symbol}` : ''}`
              : `Call ${shortAddress(target)} with raw calldata${data.length >= 10 ? ` (selector ${slice(data, 0, 4)})` : ''}`,
        }
      : undefined
  useReport(result, onResult)

  return (
    <div className="flex flex-col gap-4">
      <AddressField
        label="Contract"
        chainId={safe.chainId}
        value={targetText}
        onChange={setTargetText}
      />
      {target && inspection.isPending && (
        <p className="text-sm text-muted-foreground">Reading the contract's bytecode…</p>
      )}
      {inspection.error && (
        <p className="text-sm text-destructive">{describeError(inspection.error)}</p>
      )}
      {inspection.data && <InspectionNote inspection={inspection.data} />}

      {inspection.data?.hasCode && (
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as 'function' | 'raw')}
          className="flex gap-4"
        >
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="function" /> Pick a function
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="raw" /> Raw calldata
          </Label>
        </RadioGroup>
      )}

      {inspection.data?.hasCode && mode === 'function' && (
        <div className="flex flex-col gap-3">
          {options.length > 0 ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fn">Function</Label>
                <Select
                  id="fn"
                  value={option?.key}
                  onChange={(e) => setSelected(e.target.value)}
                  className="font-mono"
                >
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {signature(o.fn)} · {o.source}
                    </option>
                  ))}
                </Select>
                {hidden > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {hidden} function(s) from your saved ABI aren't in this contract's bytecode and
                    are hidden.
                  </p>
                )}
              </div>
              {option?.fn.inputs.map((p, i) => {
                const k = `${option.key}:${i}`
                return (
                  <div key={k} className="flex flex-col gap-1.5">
                    <Label htmlFor={k}>
                      {p.name || `Argument ${i + 1}`}{' '}
                      <span className="font-mono text-xs text-muted-foreground">{p.type}</span>
                    </Label>
                    <Input
                      id={k}
                      className="font-mono text-sm"
                      spellCheck={false}
                      placeholder={argPlaceholder(p)}
                      value={args[k] ?? ''}
                      onChange={(e) => setArgs((a) => ({ ...a, [k]: e.target.value }))}
                    />
                  </div>
                )
              })}
              {argError && <p className="text-sm text-destructive">{argError}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No known ABI for this contract. Paste its ABI below, or use raw calldata.
            </p>
          )}
          {inspection.data.implementationCodeHash && (
            <PasteAbi chainId={safe.chainId} inspection={inspection.data} />
          )}
          {options.length === 0 && inspection.data.selectors.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {inspection.data.selectors.length} function selectors found in the bytecode
              </summary>
              <p className="mt-1 font-mono text-xs break-all">
                {inspection.data.selectors.join(' ')}
              </p>
            </details>
          )}
        </div>
      )}

      {inspection.data?.hasCode && mode === 'raw' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="raw">Calldata</Label>
          <textarea
            id="raw"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="0x…"
            className="rounded-lg border bg-background p-2 font-mono text-xs"
          />
          {raw.trim() !== '' && data === undefined && (
            <p className="text-sm text-destructive">Enter 0x-prefixed hex bytes.</p>
          )}
        </div>
      )}

      {inspection.data && (
        <AmountField
          label={`Value sent with the call (${currency.symbol})`}
          value={valueText}
          onChange={setValueText}
          decimals={currency.decimals}
          symbol={currency.symbol}
          max={safe.balance}
        />
      )}
      {notPayable && (
        <p className="text-sm text-destructive">
          This function is not payable; sending value would revert.
        </p>
      )}
    </div>
  )
}

function InspectionNote({ inspection: i }: { inspection: ContractInspection }) {
  if (!i.hasCode) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        This address has no code (an EOA). A contract call to it does nothing.
      </p>
    )
  }
  if (i.delegatedTo) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        This is an EOA delegated (EIP-7702) to {i.delegatedTo}. Its functions can't be read here;
        use raw calldata.
      </p>
    )
  }
  return (
    <p className="text-sm text-muted-foreground">
      {i.isProxy ? `Upgradeable proxy → implementation ${i.implementation}. ` : ''}
      {i.selectors.length} function selectors in the bytecode.
    </p>
  )
}

function PasteAbi({ chainId, inspection }: { chainId: number; inspection: ContractInspection }) {
  const save = useSaveAbi()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  if (!open) {
    return (
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        Paste ABI
      </Button>
    )
  }
  const submit = async () => {
    setError(undefined)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return setError('Not valid JSON.')
    }
    const decoded = Schema.decodeUnknownEither(Abi)(json)
    if (decoded._tag === 'Left') return setError('Not a valid ABI.')
    await save.mutateAsync({
      chainId,
      implementation: inspection.implementation,
      codeHash: inspection.implementationCodeHash as Hex,
      label: shortAddress(inspection.address),
      abi: decoded.right,
      savedAt: new Date().toISOString(),
    })
    setOpen(false)
    setText('')
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <Label htmlFor="abi">ABI (JSON)</Label>
      <textarea
        id="abi"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="rounded-lg border bg-background p-2 font-mono text-xs"
        spellCheck={false}
      />
      <p className="text-xs text-muted-foreground">
        Saved to your ABI library for this contract's current code. If the contract is upgraded, the
        ABI stops being used.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={save.isPending}>
          Save ABI
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

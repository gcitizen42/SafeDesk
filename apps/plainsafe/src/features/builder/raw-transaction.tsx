import { useQuery } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Select } from '@/components/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { importBuilderJson, parseSafeTx } from '@/core/builder-json'
import type { SafeTx } from '@/core/safe-tx'
import { run } from '@/effect/run'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { multiSendCallOnly } from '@/features/swap/program'
import type { BuiltCall } from './presets'

export function RawTransaction({
  safe,
  initialTx,
  nonce,
  onResult,
  onImport,
}: {
  safe: SafeSnapshot
  initialTx?: SafeTx
  nonce: bigint
  onResult: (call: BuiltCall | undefined) => void
  onImport: (tx: SafeTx) => void
}) {
  const [to, setTo] = useState(initialTx?.to ?? ''),
    [value, setValue] = useState(initialTx?.value.toString() ?? '0'),
    [data, setData] = useState(initialTx?.data ?? '0x'),
    [operation, setOperation] = useState(initialTx?.operation ?? 0)
  const [error, setError] = useState('')
  const multiSend = useQuery({
    queryKey: [
      'builder-multisend',
      safe.chainId,
      safe.authenticity.status === 'verified' ? safe.authenticity.version : '',
    ],
    queryFn: () =>
      run(
        multiSendCallOnly(
          safe.chainId,
          safe.authenticity.status === 'verified' ? safe.authenticity.version : '1.3.0',
        ),
      ),
    enabled: false,
  })
  useEffect(() => {
    try {
      const tx = parseSafeTx({
        ...initialTx,
        to,
        value,
        data,
        operation,
        nonce: String(nonce),
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: '0x0000000000000000000000000000000000000000',
        refundReceiver: '0x0000000000000000000000000000000000000000',
      })
      onResult({
        call: tx,
        description: operation === 1 ? 'Delegatecall transaction' : 'Contract transaction',
      })
    } catch {
      onResult(undefined)
    }
  }, [to, value, data, operation, nonce, onResult, initialTx])
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <FileUp className="size-4" />
        Import Builder JSON / full SafeTx
        <input
          aria-label="Import Builder JSON"
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            try {
              if (file.size > 2 * 1024 * 1024) throw new Error('JSON file exceeds 2MB')
              const parsed = JSON.parse(await file.text())
              const needsBatch =
                Array.isArray(parsed.transactions) && parsed.transactions.length > 1
              const helper = needsBatch ? (await multiSend.refetch()).data : undefined
              const tx = importBuilderJson(parsed, {
                chainId: safe.chainId,
                safe: safe.address,
                nonce,
                multiSend: helper,
              })
              setTo(tx.to)
              setValue(tx.value.toString())
              setData(tx.data)
              setOperation(tx.operation)
              onImport(tx)
              setError('')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Invalid JSON')
            } finally {
              e.target.value = ''
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="raw-to">Target contract</Label>
        <Input id="raw-to" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="raw-value">Native value (base units)</Label>
        <Input
          id="raw-value"
          value={value}
          inputMode="numeric"
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="raw-operation">Operation</Label>
        <Select
          id="raw-operation"
          value={operation}
          onChange={(e) => setOperation(Number(e.target.value) as 0 | 1)}
        >
          <option value={0}>CALL (0)</option>
          <option value={1}>DELEGATECALL (1)</option>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="raw-data">Calldata</Label>
        <textarea
          id="raw-data"
          className="min-h-32 rounded-lg border p-3 font-mono text-xs break-all"
          value={data}
          onChange={(e) => setData(e.target.value as `0x${string}`)}
          spellCheck={false}
        />
      </div>
    </div>
  )
}

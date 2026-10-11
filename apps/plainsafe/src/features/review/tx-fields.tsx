// Every SafeTx field, raw (SPEC §3.4 item 3: raw fields folded away).
import { formatUnits } from 'viem'
import { AddressView } from '@/components/address'
import type { SafeTx } from '@/core/safe-tx'
import { useChain } from '@/queries/settings'

export function TxFields({ chainId, tx }: { chainId: number; tx: SafeTx }) {
  const currency = useChain(chainId)?.nativeCurrency
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">All transaction fields</summary>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">to</dt>
        <dd>
          <AddressView chainId={chainId} address={tx.to} full />
        </dd>
        <dt className="text-muted-foreground">value</dt>
        <dd className="font-mono">
          {tx.value.toString()}{' '}
          {currency && `(${formatUnits(tx.value, currency.decimals)} ${currency.symbol})`}
        </dd>
        <dt className="text-muted-foreground">data</dt>
        <dd className="font-mono text-xs break-all">{tx.data}</dd>
        <dt className="text-muted-foreground">operation</dt>
        <dd>{tx.operation === 0 ? '0 (call)' : '1 (delegatecall)'}</dd>
        {(['safeTxGas', 'baseGas', 'gasPrice'] as const).map((f) => (
          <FieldRow key={f} name={f} value={tx[f].toString()} />
        ))}
        <FieldRow name="gasToken" value={tx.gasToken} />
        <FieldRow name="refundReceiver" value={tx.refundReceiver} />
        <FieldRow name="nonce" value={tx.nonce.toString()} />
      </dl>
    </details>
  )
}

function FieldRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </>
  )
}

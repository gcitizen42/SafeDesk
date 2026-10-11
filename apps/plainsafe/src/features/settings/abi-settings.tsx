// Settings → ABI library (SPEC §3.12, §7.3): ABIs you pasted, tied to implementation code.
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRemoveAbi, useSaveAbi, useSavedAbis } from '@/queries/contracts'
import { useChainName } from '@/queries/settings'

export function AbiSettings() {
  const list = useSavedAbis()
  const save = useSaveAbi()
  const remove = useRemoveAbi()
  const records = (list.data?.records ?? [])
    .map((r) => r.value)
    .sort((a, b) => a.label.localeCompare(b.label))
  const chainName = useChainName()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">ABI library</h2>
      <p className="text-sm text-muted-foreground">
        ABIs you pasted in the contract-call builder. Each is tied to the contract's implementation
        code hash, so if the contract is upgraded or replaced, its ABI stops being used. To add one,
        open a contract call and choose Paste ABI.
      </p>
      {list.data && list.data.invalid.length > 0 && (
        <p className="text-sm text-destructive">
          {list.data.invalid.length} saved ABI(s) are invalid and were not used.
        </p>
      )}
      {records.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved ABIs.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="abi-library">
          {records.map((r) => {
            const functions = r.abi.filter((i) => i.type === 'function').length
            return (
              <li key={`${r.chainId}:${r.codeHash}`} className="flex items-center gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Input
                    aria-label={`Label for the ABI of ${r.implementation}`}
                    defaultValue={r.label}
                    maxLength={100}
                    onBlur={(e) => {
                      const label = e.target.value.trim()
                      if (label && label !== r.label) save.mutate({ ...r, label })
                    }}
                  />
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {chainName(r.chainId)} · implementation {r.implementation} · code{' '}
                    {r.codeHash.slice(0, 10)}… · {functions} function{functions === 1 ? '' : 's'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete the ABI ${r.label}`}
                  onClick={() => remove.mutate({ chainId: r.chainId, codeHash: r.codeHash })}
                >
                  <Trash2 />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

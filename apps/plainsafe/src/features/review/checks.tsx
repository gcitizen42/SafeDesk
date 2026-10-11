// whatsabi checks on the review screen (SPEC §7.3).
import type { SafeTx } from '@/core/safe-tx'
import type { ContractInspection } from '@/features/abi/inspect'

export function WhatsabiChecks({
  tx,
  inspection,
}: {
  tx: SafeTx
  inspection?: ContractInspection | undefined
}) {
  if (!inspection)
    return <p className="text-sm text-muted-foreground">Checking the target's bytecode…</p>
  const selector = tx.data.length >= 10 ? tx.data.slice(0, 10).toLowerCase() : undefined
  const items: [boolean, string][] = []
  if (!inspection.hasCode)
    items.push([
      tx.data === '0x',
      tx.data === '0x'
        ? 'Recipient has no code (an EOA)'
        : 'Target has no code (an EOA), but calldata is present',
    ])
  else if (inspection.delegatedTo)
    items.push([true, `Target is an EOA delegated (EIP-7702) to ${inspection.delegatedTo}`])
  else {
    items.push([true, 'Target is a contract'])
    if (inspection.isProxy)
      items.push([
        true,
        `Target is an upgradeable proxy → implementation ${inspection.implementation}`,
      ])
    if (selector) {
      const found = inspection.selectors.some((s) => s.toLowerCase() === selector)
      items.push([
        found,
        found
          ? `Function ${selector} is in the bytecode`
          : `Function ${selector} is not in the target's bytecode`,
      ])
    }
  }
  return (
    <section
      className="flex flex-col gap-1 rounded-lg border p-4 text-sm"
      data-testid="whatsabi-checks"
    >
      <h2 className="font-medium">Contract checks</h2>
      <ul className="flex flex-col gap-1">
        {items.map(([ok, text]) => (
          <li key={text} className={ok ? '' : 'text-amber-700 dark:text-amber-400'}>
            {ok ? '✓' : '⚠'} {text}
          </li>
        ))}
      </ul>
    </section>
  )
}

// Execution (SPEC §3.8): anyone can execute once there are enough owner signatures.
import { ExternalLink } from 'lucide-react'
import type { Address, Hex } from 'viem'
import { useConnection } from 'wagmi'
import { explorerUrl } from '@/chains'
import { Button } from '@/components/ui/button'
import { planExecution } from '@/core/execution'
import type { SafeTx } from '@/core/safe-tx'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useChain } from '@/queries/settings'
import type { PackageSignature } from '@/schemas/package'
import { useExecute } from './use-execute'

export function ExecutePanel(props: {
  chainId: number
  safe: SafeSnapshot
  tx: SafeTx
  safeTxHash: Hex
  signatures: readonly PackageSignature[]
  /** Owners who approved onchain; they count as signatures (SPEC §5.2). */
  approvedBy?: readonly Address[] | undefined
}) {
  const { safe, tx } = props
  const connection = useConnection()
  const chain = useChain(props.chainId)
  const execute = useExecute()
  if (!safe.owners || safe.threshold === undefined || safe.nonce === undefined) return null
  if (safe.authenticity.status !== 'verified') return null

  const plan = planExecution({
    signatures: props.signatures,
    owners: safe.owners,
    threshold: safe.threshold,
    executor: connection.address,
    approvedBy: props.approvedBy,
  })
  const link = execute.txHash && chain ? explorerUrl(chain, 'tx', execute.txHash) : undefined

  if (execute.step === 'done' && execute.data) {
    return (
      <p
        className="text-right text-sm text-emerald-700 dark:text-emerald-400"
        data-testid="execute-status"
      >
        {execute.data.outcome === 'executed' ? 'Executed' : 'Executed, but the inner call failed'}{' '}
        in {execute.data.hash}
      </p>
    )
  }
  if (tx.nonce > safe.nonce) {
    return (
      <p className="text-right text-sm text-muted-foreground">
        Waiting: nonce {safe.nonce.toString()} must execute first.
      </p>
    )
  }
  if (tx.nonce < safe.nonce) {
    return (
      <p className="text-right text-sm text-muted-foreground">
        Nonce {tx.nonce.toString()} is already used onchain (executed or replaced).
      </p>
    )
  }
  if (plan.kind === 'missing') {
    return (
      <p className="text-right text-sm text-muted-foreground">
        {plan.missing} more owner signature{plan.missing === 1 ? '' : 's'} needed before anyone can
        execute.
      </p>
    )
  }
  return (
    <div className="flex flex-col items-end gap-2" data-testid="execute-panel">
      {plan.prevalidatedFor && (
        <p className="text-sm text-muted-foreground">
          As an owner sending the transaction, {shortAddress(plan.prevalidatedFor)} provides the
          last signature by executing.
        </p>
      )}
      {!connection.address && (
        <p className="text-sm text-muted-foreground">
          Connect any wallet to pay the gas and execute.
        </p>
      )}
      {execute.error && (
        <p className="max-w-md text-right text-sm text-destructive" data-testid="execute-error">
          {describeError(execute.error).split('\n')[0]}
        </p>
      )}
      {execute.step === 'pending' && (
        <p className="text-sm">
          Waiting for {execute.txHash}…{' '}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              explorer <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      )}
      <Button
        size="lg"
        data-testid="execute"
        disabled={!connection.address || execute.isPending}
        onClick={() =>
          execute.mutate({
            chainId: props.chainId,
            safe: safe.address,
            tx,
            safeTxHash: props.safeTxHash,
            signatures: plan.signatures,
          })
        }
      >
        {execute.step === 'estimating'
          ? 'Estimating gas…'
          : execute.step === 'wallet'
            ? 'Confirm in your wallet…'
            : execute.step === 'pending'
              ? 'Executing…'
              : 'Execute'}
      </Button>
    </div>
  )
}

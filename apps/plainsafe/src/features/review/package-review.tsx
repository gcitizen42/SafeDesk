// #/safe/:chainId/:address/tx/:safeTxHash: a stored package (SPEC §3.4–§3.8).
import { ExternalLink } from 'lucide-react'
import { type Address, type Hex, isHex } from 'viem'
import { useLocation, useParams } from 'wouter'
import { explorerUrl } from '@/chains'
import { Callout } from '@/components/callout'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { cancelTx, isCancel } from '@/core/builders'
import type { VerifiedPackage } from '@/core/package'
import { setDraft } from '@/features/builder/draft'
import { ExecutePanel } from '@/features/execute/execute-panel'
import { PackageNotFound } from '@/features/queue/store'
import { useSafeParams } from '@/features/safes/use-safe-params'
import { SharePanel } from '@/features/share/share-panel'
import { describeError } from '@/lib/errors'
import { useApprovals, useApproveHash } from '@/queries/approvals'
import { usePackage } from '@/queries/packages'
import { useChain } from '@/queries/settings'
import type { StoredPackage } from '@/schemas/stored-package'
import { type ReviewContext, ReviewScreen } from './review-screen'
import { SignButton } from './sign-actions'
import { SignatureProgress } from './signature-progress'
import { useSignAndSave } from './use-sign-and-save'

export function PackageReview() {
  const target = useSafeParams()
  const { safeTxHash } = useParams<{ safeTxHash: string }>()
  if (!target || !isHex(safeTxHash) || safeTxHash.length !== 66) return <NotFound />
  return <Loaded chainId={target.chainId} safe={target.address} safeTxHash={safeTxHash} />
}

function Loaded({
  chainId,
  safe,
  safeTxHash,
}: {
  chainId: number
  safe: Address
  safeTxHash: Hex
}) {
  const stored = usePackage(chainId, safe, safeTxHash)
  if (stored.isPending)
    return <p className="mx-auto max-w-2xl px-4 py-8 text-muted-foreground">Loading…</p>
  if (stored.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="text-destructive">
          {stored.error instanceof PackageNotFound
            ? "This transaction isn't in this browser's queue. Open the shared link or file again to import it."
            : describeError(stored.error)}
        </p>
      </div>
    )
  }
  const { verified, execution } = stored.data
  return (
    <ReviewScreen chainId={chainId} safeAddress={safe} tx={verified.tx} note={verified.pkg.note}>
      {(ctx) => (
        <PackageSections
          ctx={ctx}
          chainId={chainId}
          safe={safe}
          verified={verified}
          execution={execution}
        />
      )}
    </ReviewScreen>
  )
}

/**
 * Signature progress with onchain approvals counted (SPEC §5.2) and sharing, then, until it has
 * executed, the buttons to sign, approve onchain, execute or cancel.
 */
function PackageSections({
  ctx,
  chainId,
  safe,
  verified,
  execution,
}: {
  ctx: ReviewContext
  chainId: number
  safe: Address
  verified: VerifiedPackage
  execution: StoredPackage['execution']
}) {
  const { pkg, tx, signatures } = verified
  const safeTxHash = verified.hashes.safeTx
  const snapshot = ctx.safe
  const approvals = useApprovals(chainId, snapshot, safeTxHash)
  const signAndSave = useSignAndSave(chainId, safe, tx)
  const approve = useApproveHash()
  return (
    <>
      {execution && <ExecutionState chainId={chainId} execution={execution} />}
      <SignatureProgress
        chainId={chainId}
        safe={snapshot}
        signatures={signatures}
        rejected={verified.rejected}
        approvedBy={approvals.data}
      />
      <SharePanel pkg={pkg} />
      {!execution && (
        <div className="flex flex-col gap-4">
          <SignButton
            {...ctx}
            signers={signatures.map((s) => s.signer)}
            approvedBy={approvals.data}
            onSign={() => signAndSave.mutate({ pkg, withSignature: true })}
            busy={signAndSave.isPending}
            error={signAndSave.error}
            onApprove={
              snapshot
                ? () => approve.mutate({ chainId, safe: snapshot.address, safeTxHash })
                : undefined
            }
            approveBusy={approve.isPending}
            approveError={approve.error}
          />
          {snapshot && (
            <ExecutePanel
              chainId={chainId}
              safe={snapshot}
              tx={tx}
              safeTxHash={safeTxHash}
              signatures={signatures}
              approvedBy={approvals.data}
            />
          )}
          {snapshot?.nonce !== undefined &&
            tx.nonce >= snapshot.nonce &&
            !isCancel(snapshot.address, tx) && (
              <CancelAction chainId={chainId} safe={snapshot.address} nonce={tx.nonce} />
            )}
        </div>
      )}
    </>
  )
}

/** A one-click cancel (P1): a new transaction at the same nonce that does nothing. */
function CancelAction({ chainId, safe, nonce }: { chainId: number; safe: Address; nonce: bigint }) {
  const [, navigate] = useLocation()
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Button
        variant="ghost"
        size="sm"
        data-testid="cancel-tx"
        onClick={() => {
          setDraft({
            chainId,
            safe,
            tx: cancelTx(safe, nonce),
            description: `Cancel: an empty call that uses up nonce ${nonce}`,
            preset: 'eth',
          })
          navigate(`/safe/${chainId}/${safe}/review`)
        }}
      >
        Cancel this transaction
      </Button>
      <p className="max-w-md text-xs text-muted-foreground">
        Creates an empty transaction at nonce {nonce.toString()}. Once it's signed and executed,
        nothing else at this nonce can execute. It needs the same number of signatures.
      </p>
    </div>
  )
}

/** Recorded execution (SPEC §3.8): the explorer link comes from the chain config and is never fetched. */
function ExecutionState({
  chainId,
  execution,
}: {
  chainId: number
  execution: NonNullable<StoredPackage['execution']>
}) {
  const chain = useChain(chainId)
  const link = chain ? explorerUrl(chain, 'tx', execution.txHash) : undefined
  const ok = execution.status === 'executed'
  return (
    <div data-testid="execution-state" data-status={execution.status}>
      <Callout
        severity={ok ? 'info' : 'red'}
        title={ok ? 'Executed' : 'Executed, but the inner call failed (ExecutionFailure)'}
      >
        <span className="font-mono text-xs break-all">{execution.txHash}</span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-1 underline"
          >
            explorer <ExternalLink className="size-3" />
          </a>
        )}
      </Callout>
    </div>
  )
}

// #/safe/:chainId/:address/review: the builder's unsaved draft (SPEC §9.4).
import { Share2 } from 'lucide-react'
import { Link, Redirect, useLocation } from 'wouter'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { makePackage } from '@/core/package'
import { signingRefused } from '@/core/safety-rules'
import { clearDraft, type Draft, getDraft } from '@/features/builder/draft'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useSafeParams } from '@/features/safes/use-safe-params'
import { ReviewScreen } from './review-screen'
import { SignButton } from './sign-actions'
import { useSignAndSave } from './use-sign-and-save'

export function DraftReview() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  const draft = getDraft(target.chainId, target.address)
  // A reload loses the in-memory draft: go back to the builder.
  if (!draft) return <Redirect to={`/safe/${target.chainId}/${target.address}/new`} replace />
  return <DraftReviewFor draft={draft} />
}

function DraftReviewFor({ draft }: { draft: Draft }) {
  const [, navigate] = useLocation()
  const signAndSave = useSignAndSave(draft.chainId, draft.safe, draft.tx, () => clearDraft(draft))
  const base = `/safe/${draft.chainId}/${draft.safe}`

  /** Save the draft as a package, signed or not, and open it. */
  const saveDraft = (safe: SafeSnapshot | undefined, withSignature: boolean) => {
    if (safe?.authenticity.status !== 'verified') return
    const pkg = makePackage({
      chainId: draft.chainId,
      safe: draft.safe,
      safeVersion: safe.authenticity.version,
      tx: draft.tx,
    })
    // Only while this screen is open; the draft is cleared by the mutation either way
    signAndSave.mutate(
      { pkg, withSignature },
      { onSuccess: (v) => navigate(`${base}/tx/${v.hashes.safeTx}`) },
    )
  }

  return (
    <ReviewScreen
      chainId={draft.chainId}
      safeAddress={draft.safe}
      tx={draft.tx}
      description={draft.description}
    >
      {(ctx) => (
        <div className="flex flex-col gap-3">
          <SignButton
            {...ctx}
            signers={[]}
            busy={signAndSave.isPending}
            error={signAndSave.error}
            onSign={() => saveDraft(ctx.safe, true)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link href={`${base}/new/${draft.preset}`}>Edit</Link>
            </Button>
            <Button
              variant="outline"
              disabled={
                !ctx.safe || !ctx.banners || signingRefused(ctx.banners) || signAndSave.isPending
              }
              onClick={() => saveDraft(ctx.safe, false)}
            >
              <Share2 /> Share without signing
            </Button>
          </div>
        </div>
      )}
    </ReviewScreen>
  )
}

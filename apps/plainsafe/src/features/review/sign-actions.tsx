// The main button (SPEC §3.4): who may sign, and the typed confirmation for delegatecall.
import { useState } from 'react'
import { useConnection } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type Banner,
  isUnverified,
  needsTypedConfirmation,
  signingRefused,
} from '@/core/safety-rules'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import type { ReviewContext } from './review-screen'

const CONFIRM_WORD = 'DELEGATECALL'

type SignState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'no-wallet' }
  | { readonly kind: 'not-owner'; readonly account: string }
  | { readonly kind: 'signed' }
  | { readonly kind: 'approved' }
  | { readonly kind: 'can-sign' }

function signState(args: {
  pending: boolean
  banners?: readonly Banner[] | undefined
  safe?: SafeSnapshot | undefined
  account?: string | undefined
  signers: readonly string[]
  /** Owners who approved the hash onchain (approveHash). */
  approvedBy?: readonly string[] | undefined
}): SignState {
  if (args.pending || !args.banners || !args.safe) return { kind: 'checking' }
  if (signingRefused(args.banners)) return { kind: 'refused' }
  if (!args.account) return { kind: 'no-wallet' }
  const a = args.account.toLowerCase()
  if (!args.safe.owners?.some((o) => o.toLowerCase() === a))
    return { kind: 'not-owner', account: args.account }
  if (args.signers.some((s) => s.toLowerCase() === a)) return { kind: 'signed' }
  if (args.approvedBy?.some((s) => s.toLowerCase() === a)) return { kind: 'approved' }
  return { kind: 'can-sign' }
}

export function SignButton(
  props: ReviewContext & {
    signers: readonly string[]
    onSign: () => void
    busy: boolean
    error: Error | null
    approvedBy?: readonly string[] | undefined
    /** Approve onchain instead of signing (stored packages only). */
    onApprove?: (() => void) | undefined
    approveBusy?: boolean
    approveError?: Error | null
  },
) {
  const connection = useConnection()
  const [typed, setTyped] = useState('')
  const state = signState({
    pending: props.pending,
    banners: props.banners,
    safe: props.safe,
    account: connection.address,
    signers: props.signers,
    approvedBy: props.approvedBy,
  })
  const confirm = props.banners ? needsTypedConfirmation(props.banners) : false
  const unconfirmed = confirm && typed !== CONFIRM_WORD
  const error = props.error ?? props.approveError
  const label = props.simulationFailed
    ? 'Sign anyway'
    : props.banners && isUnverified(props.banners)
      ? 'Sign unverified transaction'
      : 'Sign'
  return (
    <div className="flex flex-col items-end gap-2">
      {state.kind === 'no-wallet' && (
        <p className="text-sm text-muted-foreground">
          Connect an owner's wallet (top right) to sign.
        </p>
      )}
      {state.kind === 'not-owner' && (
        <p className="text-sm text-muted-foreground">
          The connected account {shortAddress(state.account)} is not an owner of this Safe, so it
          can't sign.
        </p>
      )}
      {state.kind === 'signed' && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          You have signed this transaction.
        </p>
      )}
      {state.kind === 'approved' && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          You have approved this transaction onchain.
        </p>
      )}
      {state.kind === 'can-sign' && confirm && (
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="delegatecall-confirm">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm you
            understand this can take over the Safe:
          </label>
          <Input
            id="delegatecall-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="font-mono"
          />
        </div>
      )}
      {error && (
        <p className="max-w-md text-right text-sm text-destructive">
          {describeError(error).split('\n')[0]}
        </p>
      )}
      {(state.kind === 'can-sign' || state.kind === 'checking' || state.kind === 'refused') && (
        <Button
          size="lg"
          data-testid="main-action"
          disabled={state.kind !== 'can-sign' || props.busy || unconfirmed}
          onClick={props.onSign}
        >
          {state.kind === 'checking'
            ? 'Checking…'
            : state.kind === 'refused'
              ? 'Signing refused'
              : props.busy
                ? 'Waiting for the wallet…'
                : label}
        </Button>
      )}
      {state.kind === 'can-sign' && props.onApprove && (
        <div className="flex max-w-md flex-col items-end gap-1 text-right">
          <Button
            variant="outline"
            size="sm"
            data-testid="approve-onchain"
            disabled={props.busy || props.approveBusy || unconfirmed}
            onClick={props.onApprove}
          >
            {props.approveBusy ? 'Waiting for the approval…' : 'Approve onchain instead'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Sends a transaction from your wallet (it costs gas) that records your approval of this
            safeTxHash in the Safe, instead of an off-chain signature. It counts the same.
          </p>
        </div>
      )}
    </div>
  )
}

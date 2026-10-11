// The one review screen (SPEC §3.4), for drafts and stored packages alike.

import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { AddressView } from '@/components/address'
import { TooltipButton } from '@/components/tooltip-button'
import { describeCall, tokenLookup } from '@/core/describe'
import { type SafeTx, safeTxHashes } from '@/core/safe-tx'
import type { Banner } from '@/core/safety-rules'
import { AuthenticityBadge } from '@/features/safes/authenticity-badge'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { SwapPanel } from '@/features/swap/swap-panel'
import { describeError } from '@/lib/errors'
import { useClearSigning } from '@/queries/clear-signing'
import { useChain, useNativeCurrency } from '@/queries/settings'
import { useSimulation } from '@/queries/simulation'
import { useTokenUniverse } from '@/queries/tokens'
import { useTxAnalysis } from './analysis'
import { SafetyBanners } from './banners'
import { WhatsabiChecks } from './checks'
import { ClearSigningView } from './clear-signing-view'
import { DecodedView } from './decoded-view'
import { HashesPanel } from './hashes'
import { SimulationPanel, simulationFailed } from './simulation-panel'
import { TxFields } from './tx-fields'
import { clearSigningSummary } from './tx-summary'

export interface ReviewContext {
  readonly safe?: SafeSnapshot | undefined
  readonly banners?: readonly Banner[] | undefined
  readonly pending: boolean
  /** A simulation ran and predicts failure (SPEC §7.5): the button says "Sign anyway". */
  readonly simulationFailed: boolean
}

export function ReviewScreen(props: {
  chainId: number
  safeAddress: Address
  tx: SafeTx
  /** The builder's own description (SPEC §3.4 item 2). */
  description?: string | undefined
  /** A package note: always shown as unverified (SPEC §6). */
  note?: string | undefined
  /** Everything below the hashes: signature progress, then the main button. */
  children: (ctx: ReviewContext) => ReactNode
}) {
  const { chainId, safeAddress, tx } = props
  const chain = useChain(chainId)
  const { safe, inspection, analysis, remoteErrors } = useTxAnalysis(chainId, safeAddress, tx)
  const hashes = safeTxHashes(chainId, safeAddress, tx)
  const clear = useClearSigning(chainId, safe.data, tx, hashes.safeTx)
  const simulation = useSimulation(chainId, safe.data, tx, hashes.safeTx)
  const currency = useNativeCurrency(chainId)
  const tokens = useTokenUniverse(chainId)
  // SPEC §7.1: clear signing leads when it describes the call
  const clearSummary = clearSigningSummary(clear.data, tx, safeAddress)
  const summary =
    clearSummary ??
    props.description ??
    (analysis.decoded
      ? describeCall(tx, analysis.decoded, safeAddress, currency, tokenLookup(tokens))
      : 'Checking…')
  const decodedView = analysis.decoded && (
    <DecodedView
      chainId={chainId}
      tx={tx}
      decoded={analysis.decoded}
      guess={analysis.guess}
      safe={safe.data}
    />
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
      {/* 1. Safe identity */}
      <section className="flex flex-col gap-1" data-testid="identity">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>
            {chain?.name ?? `Chain ${chainId}`} · nonce {tx.nonce.toString()}
            {safe.data && ` · Safe read at block ${safe.data.block.toString()}`}
          </span>
          <TooltipButton
            variant="outline"
            size="xs"
            onClick={() => void safe.refetch()}
            disabled={safe.isFetching}
            tip="Read the Safe again at the latest block: owners, threshold, nonce and balance."
          >
            <RefreshCw /> {safe.isFetching ? 'Refreshing…' : 'Refresh'}
          </TooltipButton>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AddressView chainId={chainId} address={safeAddress} />
          {safe.data && <AuthenticityBadge authenticity={safe.data.authenticity} />}
        </div>
        {safe.error && <p className="text-sm text-destructive">{describeError(safe.error)}</p>}
      </section>

      {/* 2. Summary */}
      <h1 className="text-xl font-semibold" data-testid="summary">
        {summary}
      </h1>
      {props.note && (
        <p className="rounded-lg border border-dashed p-3 text-sm">
          <span className="font-medium">Proposer's note (unverified): </span>
          {props.note}
        </p>
      )}

      {/* 4. Safety banners come first so they can't be missed */}
      {analysis.banners && <SafetyBanners banners={analysis.banners} />}
      {inspection.error && (
        <p className="text-sm text-destructive">{describeError(inspection.error)}</p>
      )}
      {remoteErrors.map((e) => (
        <p key={e.message} className="text-sm text-muted-foreground">
          {describeError(e)}
        </p>
      ))}

      {/* 3. Details: the first rendering that resolves (SPEC §7.1), the other folded away */}
      {clearSummary && clear.data ? (
        <>
          <ClearSigningView chainId={chainId} result={clear.data} />
          {decodedView && <Folded title="ABI decoding">{decodedView}</Folded>}
        </>
      ) : (
        <>
          {decodedView}
          {clear.data && (
            <Folded title="Clear-signing view">
              <ClearSigningView chainId={chainId} result={clear.data} />
            </Folded>
          )}
        </>
      )}
      {clear.error && (
        <p className="text-sm text-muted-foreground">
          Clear signing couldn't render this transaction ({describeError(clear.error)}), so the ABI
          decoding is shown instead.
        </p>
      )}
      <WhatsabiChecks tx={tx} inspection={inspection.data} />
      <SwapPanel chainId={chainId} safe={safeAddress} tx={tx} />

      {/* 5. Simulation (SPEC §7.5) */}
      {safe.data && (
        <SimulationPanel
          chainId={chainId}
          query={simulation}
          verified={safe.data.authenticity.status === 'verified'}
        />
      )}

      {/* 6. Hashes, always */}
      <HashesPanel hashes={hashes} />
      <TxFields chainId={chainId} tx={tx} />

      {/* 7. Signatures, then the main button */}
      {props.children({
        safe: safe.data,
        banners: analysis.banners,
        pending: analysis.pending,
        simulationFailed: simulationFailed(simulation),
      })}
    </div>
  )
}

function Folded({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground">{title}</summary>
      <div className="mt-3 mb-2">{children}</div>
    </details>
  )
}

// Simulation on the review screen (SPEC §7.5): green when it succeeds, yellow when it can't run,
// red only when it ran and predicts failure.
import type { UseQueryResult } from '@tanstack/react-query'
import { CircleCheck } from 'lucide-react'
import { formatUnits } from 'viem'
import { AddressView } from '@/components/address'
import { Callout } from '@/components/callout'
import type { BalanceChange } from '@/core/simulation'
import { SimulationReverted, SimulationUnavailable } from '@/effect/errors'
import type { SimulationResult } from '@/features/simulation/program'
import { describeError } from '@/lib/errors'
import { useTokenMeta } from '@/queries/contracts'
import { useNativeCurrency } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'

type SimQuery = UseQueryResult<SimulationResult, Error>

/** True when a simulation ran and predicts failure: the button becomes "Sign anyway". */
export const simulationFailed = (q: SimQuery) => q.error instanceof SimulationReverted

const LEVEL = {
  1: 'eth_simulateV1 on the real execTransaction',
  2: "the Safe's simulateAndRevert",
} as const

export function SimulationPanel({
  chainId,
  query,
  verified,
}: {
  chainId: number
  query: SimQuery
  verified: boolean
}) {
  if (!verified)
    return (
      <Callout severity="yellow" title="Not simulated">
        Simulation runs only for Safes verified by code hash.
      </Callout>
    )
  if (query.isPending)
    return (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground" data-testid="simulation">
        Simulating…
      </p>
    )
  if (query.error) {
    const e = query.error
    if (e instanceof SimulationReverted)
      return (
        <div data-testid="simulation" data-outcome="fails">
          <Callout severity="red" title="Simulation predicts this transaction fails">
            <p>{e.reason}</p>
            <p className="mt-1 text-xs opacity-80">
              As of block {e.block.toString()}, using {LEVEL[e.level]}
              {e.gasUsed !== undefined && ` · gas used ${e.gasUsed.toString()}`}.
            </p>
          </Callout>
        </div>
      )
    return (
      <div data-testid="simulation" data-outcome="unavailable">
        <Callout severity="yellow" title="Your RPC can't simulate transactions">
          {e instanceof SimulationUnavailable ? e.reason : describeError(e)} Check the details and
          hashes carefully.
        </Callout>
      </div>
    )
  }
  const r = query.data
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
      data-testid="simulation"
      data-outcome="succeeds"
      data-level={r.level}
    >
      <p className="flex items-center gap-2 font-medium">
        <CircleCheck className="size-4" /> Simulation succeeds
      </p>
      <p className="text-xs opacity-80">
        As of block {r.block.toString()}, using {LEVEL[r.level]} · gas used {r.gasUsed.toString()}.
      </p>
      {r.level === 1 ? (
        <>
          <div>
            <p className="font-medium">Balance changes for this Safe</p>
            {r.changes.length === 0 ? (
              <p className="opacity-80">None.</p>
            ) : (
              <ul data-testid="balance-changes">
                {r.changes.map((c) => (
                  <ChangeRow key={changeKey(c)} chainId={chainId} change={c} />
                ))}
              </ul>
            )}
          </div>
          {r.events.length > 0 && (
            <details>
              <summary className="cursor-pointer opacity-80">
                {r.events.length} event{r.events.length === 1 ? '' : 's'} emitted
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {r.events.map((ev) => (
                  <li key={ev.index} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{ev.name ?? ev.topic0?.slice(0, 10)}</span>
                    <span className="opacity-80">from</span>
                    <AddressView chainId={chainId} address={ev.address} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="opacity-80">
          This level reports success and gas only, not balance changes. {r.level1}
        </p>
      )}
    </section>
  )
}

const changeKey = (c: BalanceChange) =>
  c.kind === 'native' ? 'native' : `${c.kind}:${c.token}:${'id' in c ? c.id : ''}`

const signed = (delta: bigint, text: string) => `${delta > 0n ? '+' : '−'}${text}`

function ChangeRow({ chainId, change }: { chainId: number; change: BalanceChange }) {
  const native = useNativeCurrency(chainId)
  const universe = useTokenUniverse(chainId)
  const erc20 = change.kind === 'erc20' ? change.token : undefined
  const listed = erc20
    ? universe?.find((t) => t.address.toLowerCase() === erc20.toLowerCase())
    : undefined
  const meta = useTokenMeta(chainId, erc20 && universe && !listed ? erc20 : undefined)
  const abs = change.delta < 0n ? -change.delta : change.delta
  if (change.kind === 'native') {
    return (
      <li className="font-mono">
        {signed(change.delta, `${formatUnits(abs, native.decimals)} ${native.symbol}`)}
      </li>
    )
  }
  if (change.kind === 'erc20') {
    const info = listed ?? meta.data
    return (
      <li className="flex flex-wrap items-center gap-2">
        <span className="font-mono">
          {info
            ? signed(change.delta, `${formatUnits(abs, info.decimals)} ${info.symbol}`)
            : signed(change.delta, `${abs.toString()} units`)}
        </span>
        {!listed && <span className="text-xs opacity-80">(not in your lists)</span>}
        <AddressView chainId={chainId} address={change.token} />
      </li>
    )
  }
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-mono">
        {change.kind === 'erc721'
          ? signed(change.delta, `NFT #${change.id.toString()}`)
          : signed(change.delta, `${abs.toString()} of token ID ${change.id.toString()}`)}
      </span>
      <AddressView chainId={chainId} address={change.token} />
    </li>
  )
}

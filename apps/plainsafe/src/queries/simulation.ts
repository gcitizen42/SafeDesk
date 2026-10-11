import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import type { SafeTx } from '@/core/safe-tx'
import { run } from '@/effect/run'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { simulate, simulateQueue } from '@/features/simulation/program'
import { keys } from './keys'

/**
 * Simulate at the block the Safe was read at (SPEC §7.5). Only for code-hash-verified Safes:
 * the state overrides assume Safe's storage layout.
 */
export function useSimulation(
  chainId: number,
  safe: SafeSnapshot | undefined,
  tx: SafeTx,
  safeTxHash: Hex,
) {
  const verified = safe?.authenticity.status === 'verified'
  return useQuery({
    queryKey: keys.simulation(chainId, safeTxHash, safe?.block ?? 0n),
    queryFn: () => run(simulate(chainId, safe as SafeSnapshot, tx, safeTxHash)),
    enabled: !!safe && verified,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** The queue's consecutive nonces, simulated together at the Safe's pinned block (P1). */
export function useQueueSimulation(
  chainId: number,
  safe: SafeSnapshot | undefined,
  items: readonly { readonly tx: SafeTx; readonly safeTxHash: Hex }[] | undefined,
) {
  const verified = safe?.authenticity.status === 'verified'
  return useQuery({
    queryKey: keys.queueSimulation(
      chainId,
      safe?.address ?? '0x',
      safe?.block ?? 0n,
      (items ?? []).map((i) => i.safeTxHash),
    ),
    queryFn: () => run(simulateQueue(chainId, safe as SafeSnapshot, items ?? [])),
    enabled: !!safe && verified && !!items && items.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

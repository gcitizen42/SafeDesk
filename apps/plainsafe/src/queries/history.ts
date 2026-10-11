import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import type { Address, Hex } from 'viem'
import { executedSigners } from '@/core/signatures'
import { run } from '@/effect/run'
import { historyStore, historyTarget, startHistory, stopHistory } from '@/features/history/manager'
import { executingTransaction } from '@/features/history/recover'
import {
  getCheckpoint,
  listCheckpoints,
  listHistoryEvents,
  resetHistory,
  turnOffHistory,
} from '@/features/history/store'
import { type HistoryEvent, historyKey } from '@/schemas/history'
import { keys } from './keys'
import { useLoadedSettings } from './settings'

function useHistoryState(chainId: number, safe: Address) {
  const all = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot)
  return all.get(historyKey(chainId, safe))
}

/** The stored checkpoint and events, re-read as the worker commits chunks. */
export function useStoredHistory(chainId: number, safe: Address) {
  const queryClient = useQueryClient()
  const state = useHistoryState(chainId, safe)
  const checkpoint = useQuery({
    queryKey: keys.history(chainId, safe, 'checkpoint'),
    queryFn: () => run(getCheckpoint(chainId, safe)).then((c) => c ?? null),
  })
  const events = useQuery({
    queryKey: keys.history(chainId, safe, 'events'),
    queryFn: () => run(listHistoryEvents(chainId, safe)),
    enabled: !!checkpoint.data?.enabled,
  })
  const progress = state?.progress
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read whenever progress changes
  useEffect(() => {
    void invalidateHistory(queryClient, chainId, safe)
  }, [progress, queryClient, chainId, safe])
  return { checkpoint, events, state }
}

const invalidateHistory = (queryClient: QueryClient, chainId: number, safe: Address) =>
  queryClient.invalidateQueries({ queryKey: keys.history(chainId, safe) })

/** Every Safe's history checkpoint, on or off. */
export const checkpointsQuery = {
  queryKey: keys.historyCheckpoints(),
  queryFn: () => run(listCheckpoints),
}

export const useHistoryCheckpoints = () => useQuery(checkpointsQuery)

/** Start a Safe's history over from its singleton's deploy block, and start its scan. */
export function useResetHistory(chainId: number, safe: Address) {
  const settings = useLoadedSettings()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ version, floor }: { version: string; floor: bigint }) => {
      stopHistory(chainId, safe)
      await run(resetHistory(chainId, safe, version, floor))
      await invalidateHistory(queryClient, chainId, safe)
      // In the mutation, not its caller: the scan starts even if the view has closed meanwhile
      const fresh = await run(getCheckpoint(chainId, safe))
      const target = fresh && historyTarget(settings, fresh)
      if (target) startHistory(target)
    },
  })
}

/** Stop a Safe's scan and drop what it stored (a rebuildable cache, SPEC §11). */
export function useTurnOffHistory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ chainId, safe }: { chainId: number; safe: Address }) => {
      stopHistory(chainId, safe)
      await run(turnOffHistory(chainId, safe))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.allHistory() }),
  })
}

/** The transaction that emitted an execution's event: its calldata, target and sender. */
export function useExecutingTransaction(chainId: number, event: HistoryEvent, enabled: boolean) {
  return useQuery({
    queryKey: keys.historyTx(chainId, event.transactionHash),
    queryFn: () =>
      run(
        executingTransaction(
          chainId,
          event.transactionHash,
          BigInt(event.blockNumber),
          event.transactionIndex,
        ),
      ),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Who signed an execution, recovered from the signatures it carried. */
export function useExecutedSigners(safeTxHash: Hex, signatures: Hex | undefined) {
  return useQuery({
    queryKey: keys.executedSigners(safeTxHash, signatures ?? '0x'),
    queryFn: () => executedSigners(signatures as Hex, safeTxHash),
    enabled: !!signatures,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

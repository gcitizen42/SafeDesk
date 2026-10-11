// Onchain history records, read and reset from the main thread (SPEC §11). The worker writes.
import { Effect, Option } from 'effect'
import type { Address } from 'viem'
import { deployments } from '@/core/deployments'
import { INITIAL_CHUNK } from '@/core/history'
import { HistoryCheckpoint, HistoryEvent, historyEventPrefix, historyKey } from '@/schemas/history'
import { Storage } from '@/storage/service'

/** The singleton's deploy block, bundled for Mainnet and Sepolia; 0 elsewhere (SPEC §11). */
export function historyFloor(chainId: number, singleton: Address): bigint {
  const b = deployments.deployBlocks[String(chainId)]?.[singleton.toLowerCase()]
  return b ? BigInt(b) : 0n
}

export const getCheckpoint = (chainId: number, safe: Address) =>
  Effect.flatMap(Storage, (s) =>
    s.get('history_checkpoints', historyKey(chainId, safe), HistoryCheckpoint),
  ).pipe(
    Effect.map(Option.getOrUndefined),
    // An unreadable checkpoint is a cache miss: the history can be rebuilt
    Effect.orElseSucceed(() => undefined),
  )

export const listCheckpoints = Effect.flatMap(Storage, (s) =>
  s.getAll('history_checkpoints', HistoryCheckpoint),
).pipe(Effect.map(({ records }) => records.map((r) => r.value)))

export const listHistoryEvents = (chainId: number, safe: Address) =>
  Effect.flatMap(Storage, (s) =>
    s.getAllWithPrefix('history_events', historyEventPrefix(chainId, safe), HistoryEvent),
  ).pipe(Effect.map(({ records }) => records.map((r) => r.value)))

/** Turn history on (or start over, for Rebuild): no events, a fresh checkpoint. */
export const resetHistory = (chainId: number, safe: Address, version: string, floor: bigint) =>
  Effect.gen(function* () {
    const s = yield* Storage
    yield* s.removePrefix('history_events', historyEventPrefix(chainId, safe))
    yield* s.put('history_checkpoints', historyKey(chainId, safe), HistoryCheckpoint, {
      chainId,
      safe,
      version,
      enabled: true,
      floor: floor.toString(),
      chunkSize: INITIAL_CHUNK.toString(),
      setupFound: false,
      tip: [],
      updatedAt: new Date().toISOString(),
    })
  })

export const turnOffHistory = (chainId: number, safe: Address) =>
  Effect.gen(function* () {
    const s = yield* Storage
    yield* s.removePrefix('history_events', historyEventPrefix(chainId, safe))
    yield* s.remove('history_checkpoints', historyKey(chainId, safe))
  })

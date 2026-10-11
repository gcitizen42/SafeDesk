// The onchain history scanner (SPEC §11): backwards from the finalized block until the Safe's
// SafeSetup (or the singleton's deploy block), chunk by chunk, each chunk's events and the
// checkpoint written in one transaction so a scan can stop anywhere and resume. Runs in the
// history worker; the client and the storage are passed in, so it runs in tests too.
import { Effect, Option, Schedule } from 'effect'
import type { Address, Hex } from 'viem'
import {
  classifyLogError,
  completeness,
  decodeSafeLog,
  INITIAL_CHUNK,
  isExecution,
  type LogErrorKind,
  largerChunk,
  smallerChunk,
} from '@/core/history'
import { errorInfo, shortMessage } from '@/core/rpc-errors'
import {
  HistoryCheckpoint,
  HistoryEvent,
  historyEventKey,
  historyEventPrefix,
  historyKey,
} from '@/schemas/history'
import { Storage, write } from '@/storage/service'

export interface HistoryLog {
  readonly blockNumber: bigint | null
  readonly logIndex: number | null
  readonly transactionHash: Hex | null
  readonly transactionIndex?: number | null
  /** Some nodes include the block's timestamp in each log; others need a header read. */
  readonly blockTimestamp?: bigint | null
  readonly topics: readonly Hex[]
  readonly data: Hex
}

/** What the scanner needs from an RPC. */
export interface HistoryClient {
  readonly latestBlock: () => Promise<bigint>
  /** The `finalized` block, or undefined if the RPC doesn't support that tag. */
  readonly finalizedBlock: () => Promise<bigint | undefined>
  readonly getLogs: (a: {
    address: Address
    fromBlock: bigint
    toBlock: bigint
  }) => Promise<readonly HistoryLog[]>
  readonly nonce: (safe: Address) => Promise<bigint>
  /** The block's timestamp in seconds, for logs that don't carry one. */
  readonly blockTimestamp: (block: bigint) => Promise<bigint>
}

export interface ScanTarget {
  readonly chainId: number
  readonly safe: Address
  readonly version: string
  /** The singleton's deploy block (0 when unknown): below it there's nothing to find. */
  readonly floor: bigint
  readonly rpcUrl: string
}

export interface ScanProgress {
  readonly status: 'scanning' | 'complete' | 'incomplete' | 'unavailable'
  readonly reason?: string
  readonly scannedDownTo?: bigint
  readonly finalizedHead?: bigint
  readonly floor: bigint
  readonly executions: number
  readonly onchainNonce?: bigint
}

class LogsFailed {
  readonly _tag = 'LogsFailed'
  constructor(
    readonly kind: LogErrorKind,
    readonly message: string,
  ) {}
}

/** Without a `finalized` tag, stay this far behind the tip (about Mainnet's finality). */
const FALLBACK_DEPTH = 96n
/** Stored events dated per write when backfilling timestamps. */
const BACKFILL_BATCH = 50

const hasSetup = (events: readonly HistoryEvent[]) => events.some((e) => e.name === 'SafeSetup')

const toEvent = (log: HistoryLog, version: string): HistoryEvent | undefined => {
  if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) return undefined
  const e = decodeSafeLog(log, version)
  if (!e) return undefined
  return {
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
    ...(log.transactionIndex != null ? { transactionIndex: log.transactionIndex } : {}),
    ...(log.blockTimestamp != null ? { timestamp: log.blockTimestamp.toString() } : {}),
    name: e.name,
    args: e.args,
  }
}

export const scanHistory = (
  client: HistoryClient,
  target: ScanTarget,
  onProgress: (p: ScanProgress) => void,
) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const key = historyKey(target.chainId, target.safe)
    const prefix = historyEventPrefix(target.chainId, target.safe)
    // An unreadable checkpoint is treated as none: the cache is rebuilt.
    const stored = yield* storage
      .get('history_checkpoints', key, HistoryCheckpoint)
      .pipe(Effect.orElseSucceed(() => Option.none()))
    let cp: HistoryCheckpoint = Option.getOrElse(stored, () => ({
      chainId: target.chainId,
      safe: target.safe,
      version: target.version,
      enabled: true,
      chunkSize: INITIAL_CHUNK.toString(),
      setupFound: false,
      tip: [],
      updatedAt: new Date().toISOString(),
    }))
    if (cp.rpcUrl !== target.rpcUrl)
      cp = { ...cp, rpcUrl: target.rpcUrl, chunkSize: INITIAL_CHUNK.toString() }
    const storedEvents = (yield* storage.getAllWithPrefix('history_events', prefix, HistoryEvent))
      .records
    let executions = storedEvents.filter((r) => isExecution(r.value.name)).length

    // Public RPCs fail intermittently (MEV Blocker's getLogs, about 4 in 10 at times), so a
    // temporary error is retried for about a minute: 1 s, 2 s, 4 s, then every 8 s
    const rpc = <A>(f: () => Promise<A>) =>
      Effect.tryPromise({ try: f, catch: (e) => e }).pipe(
        Effect.retry({
          times: 8,
          schedule: Schedule.union(Schedule.exponential('1 second'), Schedule.spaced('8 seconds')),
          while: (e) => classifyLogError(errorInfo(e)) === 'temporary',
        }),
      )
    const getLogs = (fromBlock: bigint, toBlock: bigint) =>
      rpc(() => client.getLogs({ address: target.safe, fromBlock, toBlock })).pipe(
        Effect.mapError((e) => new LogsFailed(classifyLogError(errorInfo(e)), shortMessage(e))),
      )

    /**
     * Events with their block's timestamp: from the log when the node sent it, else one header
     * read per block. A header that can't be read (after two short retries) leaves the event
     * undated rather than stalling or failing the scan.
     */
    const dated = (events: readonly HistoryEvent[]) =>
      Effect.gen(function* () {
        const blocks = [...new Set(events.filter((e) => !e.timestamp).map((e) => e.blockNumber))]
        const times = new Map<string, string>()
        for (const b of blocks) {
          const t = yield* Effect.either(
            Effect.tryPromise({
              try: () => client.blockTimestamp(BigInt(b)),
              catch: (e) => e,
            }).pipe(
              Effect.retry({
                times: 2,
                schedule: Schedule.exponential('500 millis'),
                while: (e) => classifyLogError(errorInfo(e)) === 'temporary',
              }),
            ),
          )
          if (t._tag === 'Right') times.set(b, t.right.toString())
        }
        return events.map((e) => {
          const timestamp = e.timestamp ?? times.get(e.blockNumber)
          return timestamp ? { ...e, timestamp } : e
        })
      })
    const logsToEvents = (logs: readonly HistoryLog[]) =>
      dated(logs.flatMap((l) => toEvent(l, target.version) ?? []))

    const progress = (status: ScanProgress['status'], reason?: string): ScanProgress => ({
      status,
      ...(reason ? { reason } : {}),
      ...(cp.scannedDownTo !== undefined ? { scannedDownTo: BigInt(cp.scannedDownTo) } : {}),
      ...(cp.finalizedHead !== undefined ? { finalizedHead: BigInt(cp.finalizedHead) } : {}),
      floor: target.floor,
      executions: executions + cp.tip.filter((e) => isExecution(e.name)).length,
      ...(cp.onchainNonce !== undefined ? { onchainNonce: BigInt(cp.onchainNonce) } : {}),
    })
    /** Save events and the checkpoint together, then report. */
    const commit = (events: readonly HistoryEvent[], next: HistoryCheckpoint) =>
      Effect.gen(function* () {
        const stamped = { ...next, updatedAt: new Date().toISOString() }
        yield* storage.putMany([
          ...events.map((e) =>
            write(
              'history_events',
              historyEventKey(target.chainId, target.safe, BigInt(e.blockNumber), e.logIndex),
              HistoryEvent,
              e,
            ),
          ),
          write('history_checkpoints', key, HistoryCheckpoint, stamped),
        ])
        cp = stamped
        executions += events.filter((e) => isExecution(e.name)).length
        onProgress(progress(stamped.status ?? 'scanning', stamped.reason))
      })
    const finish = (status: 'complete' | 'incomplete' | 'unavailable', reason?: string) =>
      Effect.gen(function* () {
        const { reason: _, ...rest } = cp
        yield* commit([], { ...rest, status, ...(reason ? { reason } : {}) })
        return progress(status, reason)
      })
    const unavailable = (e: LogsFailed) =>
      finish(
        'unavailable',
        e.kind === 'refused'
          ? `Your RPC doesn't serve historical logs (${e.message}).`
          : `Your RPC kept failing: ${e.message.replace(/\.+$/, '')}. The scan resumes where it stopped next time.`,
      )

    const heads = yield* Effect.either(
      Effect.all([
        rpc(() => client.latestBlock()),
        rpc(() => client.finalizedBlock()).pipe(Effect.orElseSucceed(() => undefined)),
        rpc(() => client.nonce(target.safe)),
      ]),
    )
    if (heads._tag === 'Left')
      return yield* finish('unavailable', `Your RPC failed: ${shortMessage(heads.left)}`)
    const [latest, finalizedTag, nonce] = heads.right
    const finalized = finalizedTag ?? (latest > FALLBACK_DEPTH ? latest - FALLBACK_DEPTH : 0n)
    cp = { ...cp, onchainNonce: nonce.toString() }

    // 0. Events stored before timestamps were kept are dated once, a batch at a time
    const undated = storedEvents.filter((r) => !r.value.timestamp).map((r) => r.value)
    for (let i = 0; i < undated.length; i += BACKFILL_BATCH) {
      const batch = (yield* dated(undated.slice(i, i + BACKFILL_BATCH))).filter((e) => e.timestamp)
      yield* storage.putMany(
        batch.map((e) =>
          write(
            'history_events',
            historyEventKey(target.chainId, target.safe, BigInt(e.blockNumber), e.logIndex),
            HistoryEvent,
            e,
          ),
        ),
      )
      onProgress(progress('scanning'))
    }

    // 1. Forward: from the stored head up to the new finalized block
    if (cp.finalizedHead !== undefined) {
      let from = BigInt(cp.finalizedHead) + 1n
      while (from <= finalized) {
        const size = BigInt(cp.chunkSize)
        const to = from + size - 1n < finalized ? from + size - 1n : finalized
        const logs = yield* Effect.either(getLogs(from, to))
        if (logs._tag === 'Left') {
          if (logs.left.kind !== 'range') return yield* unavailable(logs.left)
          const smaller = smallerChunk(size)
          if (smaller === 0n)
            return yield* unavailable(new LogsFailed('refused', logs.left.message))
          cp = { ...cp, chunkSize: smaller.toString() }
          continue
        }
        const events = yield* logsToEvents(logs.right)
        yield* commit(events, {
          ...cp,
          finalizedHead: to.toString(),
          // The old tip's events up to here are stored now, so they're kept in one place only
          tip: cp.tip.filter((e) => BigInt(e.blockNumber) > to),
          chunkSize: largerChunk(size).toString(),
          setupFound: cp.setupFound || hasSetup(events),
          status: 'scanning',
        })
        from = to + 1n
      }
    } else {
      cp = { ...cp, finalizedHead: finalized.toString() }
    }

    // 2. The tip window, above the finalized block: re-fetched in full, stored apart. Read before
    // the backward scan: a Safe created there (a new Safe) has nothing below it to scan.
    if (latest > finalized) {
      const logs = yield* Effect.either(getLogs(finalized + 1n, latest))
      if (logs._tag === 'Left') return yield* unavailable(logs.left)
      const tip = yield* logsToEvents(logs.right)
      cp = { ...cp, tip, setupFound: cp.setupFound || hasSetup(tip) }
    } else {
      cp = { ...cp, tip: [] }
    }

    // 3. Backward: from below what's scanned, down to the Safe's creation or the floor
    let cursor = cp.scannedDownTo !== undefined ? BigInt(cp.scannedDownTo) - 1n : finalized
    while (!cp.setupFound && cursor >= target.floor) {
      const size = BigInt(cp.chunkSize)
      const from = cursor - size + 1n > target.floor ? cursor - size + 1n : target.floor
      const logs = yield* Effect.either(getLogs(from, cursor))
      if (logs._tag === 'Left') {
        if (logs.left.kind !== 'range') return yield* unavailable(logs.left)
        const smaller = smallerChunk(size)
        if (smaller === 0n) return yield* unavailable(new LogsFailed('refused', logs.left.message))
        cp = { ...cp, chunkSize: smaller.toString() }
        continue
      }
      const events = yield* logsToEvents(logs.right)
      yield* commit(events, {
        ...cp,
        scannedDownTo: from.toString(),
        chunkSize: largerChunk(size).toString(),
        setupFound: cp.setupFound || hasSetup(events),
        status: 'scanning',
      })
      cursor = from - 1n
    }

    const status = completeness({
      setupFound: cp.setupFound,
      executions: executions + cp.tip.filter((e) => isExecution(e.name)).length,
      onchainNonce: nonce,
      floorReached: cursor < target.floor,
    })
    return yield* finish(status.kind, status.kind === 'complete' ? undefined : status.reason)
  })

// Onchain history in IndexedDB (SPEC §11, §9.5): a rebuildable cache, left out of Back up.
import { Schema } from 'effect'
import { Address, ChainId, Hex } from './common'

const BlockNumber = Schema.String.pipe(Schema.pattern(/^\d{1,20}$/))
const ArgValue = Schema.Union(
  Schema.String.pipe(Schema.maxLength(300_000)),
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String.pipe(Schema.maxLength(100))).pipe(Schema.maxItems(1000)),
)

export const HistoryEvent = Schema.Struct({
  blockNumber: BlockNumber,
  logIndex: Schema.Int.pipe(Schema.nonNegative()),
  transactionHash: Hex,
  /** For looking the transaction up by block when the node has no transaction index. */
  transactionIndex: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  /** The block's timestamp in seconds (absent on events stored before it was kept). */
  timestamp: Schema.optional(BlockNumber),
  name: Schema.String.pipe(Schema.maxLength(64)),
  args: Schema.Record({ key: Schema.String.pipe(Schema.maxLength(64)), value: ArgValue }),
})
export type HistoryEvent = typeof HistoryEvent.Type

const HistoryStatusKind = Schema.Literal('scanning', 'complete', 'incomplete', 'unavailable')

export const HistoryCheckpoint = Schema.Struct({
  chainId: ChainId,
  safe: Address,
  version: Schema.String.pipe(Schema.maxLength(16)),
  /** The user turned history on for this Safe. */
  enabled: Schema.Boolean,
  /** The singleton's deploy block: the scan's lower bound. */
  floor: Schema.optional(BlockNumber),
  /** The RPC the chunk size was learned from; a new RPC starts over at the initial size. */
  rpcUrl: Schema.optional(Schema.String.pipe(Schema.maxLength(2048))),
  /** Top of the stored range: the finalized block when the last scan started. */
  finalizedHead: Schema.optional(BlockNumber),
  /** Lowest block scanned so far (inclusive). */
  scannedDownTo: Schema.optional(BlockNumber),
  chunkSize: BlockNumber,
  setupFound: Schema.Boolean,
  status: Schema.optional(HistoryStatusKind),
  reason: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
  /** Events above the finalized block: re-fetched in full on every refresh (SPEC §11). */
  tip: Schema.Array(HistoryEvent).pipe(Schema.maxItems(1000)),
  onchainNonce: Schema.optional(BlockNumber),
  updatedAt: Schema.String.pipe(Schema.maxLength(40)),
})
export type HistoryCheckpoint = typeof HistoryCheckpoint.Type

export const historyKey = (chainId: number, safe: string) => `${chainId}:${safe.toLowerCase()}`
/** Events sort by key: block and log index are zero-padded. */
export const historyEventKey = (chainId: number, safe: string, block: bigint, logIndex: number) =>
  `${historyKey(chainId, safe)}:${block.toString().padStart(12, '0')}:${String(logIndex).padStart(6, '0')}`
export const historyEventPrefix = (chainId: number, safe: string) => `${historyKey(chainId, safe)}:`

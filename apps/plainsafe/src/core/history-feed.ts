// The onchain history as a feed (SPEC §11): each execution with the events it caused, and the
// owner set and threshold it ran under, rebuilt from the Safe's own events. Pure.
import { type Address, getAddress } from 'viem'
import { sameAddress } from '@/lib/format'
import type { HistoryEvent } from '@/schemas/history'

/** Events that end an execution: a multisig transaction or a module's. */
const ANCHORS = new Set([
  'ExecutionSuccess',
  'ExecutionFailure',
  'ExecutionFromModuleSuccess',
  'ExecutionFromModuleFailure',
])
/** L2 Safes log every parameter before the execution (SPEC §11). */
const DETAILS = new Set(['SafeMultiSigTransaction', 'SafeModuleTransaction'])

export interface OwnerChange {
  readonly added: readonly Address[]
  readonly removed: readonly Address[]
  /** The whole set, when the history reaches back to the Safe's creation. */
  readonly before?: readonly Address[]
  readonly after?: readonly Address[]
  readonly thresholdBefore?: number
  readonly thresholdAfter?: number
}

export type FeedItem =
  | {
      readonly kind: 'execution'
      readonly event: HistoryEvent
      /** SafeMultiSigTransaction or SafeModuleTransaction, on L2 Safes. */
      readonly detail?: HistoryEvent
      /** What else the execution logged, oldest first: owner changes, modules, received ETH… */
      readonly effects: readonly HistoryEvent[]
      /** The threshold it was checked against, when known. */
      readonly threshold?: number
      /** Present when it changed the owners or the threshold. */
      readonly owners?: OwnerChange
    }
  | { readonly kind: 'event'; readonly event: HistoryEvent }

export const feedItemKey = (item: FeedItem) => `${item.event.blockNumber}:${item.event.logIndex}`

const byPosition = (a: HistoryEvent, b: HistoryEvent) => {
  const x = BigInt(a.blockNumber)
  const y = BigInt(b.blockNumber)
  return x === y ? a.logIndex - b.logIndex : x < y ? -1 : 1
}

const addr = (v: unknown) => getAddress(String(v))

/**
 * Newest first. Events logged in the same transaction before an execution belong to it (the
 * Safe logs them during the call); anything else stands on its own.
 */
export function buildFeed(events: readonly HistoryEvent[]): FeedItem[] {
  const sorted = [...events].sort(byPosition)
  let owners: Address[] | undefined
  let threshold: number | undefined
  const items: FeedItem[] = []

  const apply = (e: HistoryEvent) => {
    switch (e.name) {
      case 'SafeSetup':
        owners = (e.args.owners as readonly string[]).map(addr)
        threshold = Number(e.args.threshold)
        break
      case 'AddedOwner':
        // The Safe links a new owner in at the head of its list
        if (owners) owners = [addr(e.args.owner), ...owners]
        break
      case 'RemovedOwner':
        if (owners) owners = owners.filter((o) => !sameAddress(o, String(e.args.owner)))
        break
      case 'ChangedThreshold':
        threshold = Number(e.args.threshold)
        break
    }
  }

  let pending: HistoryEvent[] = []
  const flush = () => {
    for (const e of pending) {
      apply(e)
      items.push({ kind: 'event', event: e })
    }
    pending = []
  }

  for (const e of sorted) {
    if (pending.length > 0 && pending[0]?.transactionHash !== e.transactionHash) flush()
    if (!ANCHORS.has(e.name)) {
      pending.push(e)
      continue
    }
    const detail = pending.findLast((p) => DETAILS.has(p.name))
    const effects = pending.filter((p) => p !== detail)
    pending = []
    const before = { owners, threshold }
    for (const x of effects) apply(x)
    const change = ownerChange(effects, before, { owners, threshold })
    items.push({
      kind: 'execution',
      event: e,
      ...(detail ? { detail } : {}),
      effects,
      ...(before.threshold !== undefined ? { threshold: before.threshold } : {}),
      ...(change ? { owners: change } : {}),
    })
  }
  flush()
  return items.reverse()
}

function ownerChange(
  effects: readonly HistoryEvent[],
  before: { owners: Address[] | undefined; threshold: number | undefined },
  after: { owners: Address[] | undefined; threshold: number | undefined },
): OwnerChange | undefined {
  const touched = effects.some((e) =>
    ['AddedOwner', 'RemovedOwner', 'ChangedThreshold'].includes(e.name),
  )
  if (!touched) return undefined
  const addedRaw = effects.filter((e) => e.name === 'AddedOwner').map((e) => addr(e.args.owner))
  const removedRaw = effects.filter((e) => e.name === 'RemovedOwner').map((e) => addr(e.args.owner))
  // Removed and added back in the same execution is no change
  const added = addedRaw.filter((a) => !removedRaw.some((r) => sameAddress(a, r)))
  const removed = removedRaw.filter((r) => !addedRaw.some((a) => sameAddress(a, r)))
  return {
    added,
    removed,
    ...(before.owners && after.owners ? { before: before.owners, after: after.owners } : {}),
    ...(before.threshold !== undefined ? { thresholdBefore: before.threshold } : {}),
    ...(after.threshold !== undefined ? { thresholdAfter: after.threshold } : {}),
  }
}

/** Consecutive items with the same day, in order. Undated items get their own groups. */
export function groupByDay<T>(
  items: readonly T[],
  dayOf: (item: T) => string | undefined,
): { day: string | undefined; items: T[] }[] {
  const groups: { day: string | undefined; items: T[] }[] = []
  for (const item of items) {
    const day = dayOf(item)
    const last = groups.at(-1)
    if (last && last.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

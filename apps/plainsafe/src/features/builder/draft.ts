// The builder's unsaved draft, held in memory for the review route (SPEC §9.4). Never persisted:
// a reload returns to the builder.
import type { Address } from 'viem'
import type { SafeTx } from '@/core/safe-tx'

export interface Draft {
  readonly chainId: number
  readonly safe: Address
  readonly tx: SafeTx
  /** The builder's own one-line description, used when clear signing has nothing (SPEC §3.4). */
  readonly description: string
  /** Where "Edit" goes back to. */
  readonly preset: string
}

const drafts = new Map<string, Draft>()
const key = (chainId: number, safe: string) => `${chainId}:${safe.toLowerCase()}`

export const setDraft = (d: Draft) => drafts.set(key(d.chainId, d.safe), d)
export const getDraft = (chainId: number, safe: string) => drafts.get(key(chainId, safe))
/** Forget a draft once it's saved, unless the builder has replaced it since. */
export const clearDraft = (d: Draft) => {
  if (drafts.get(key(d.chainId, d.safe)) === d) drafts.delete(key(d.chainId, d.safe))
}

// Messages between the main thread and the history worker (SPEC §11).
import type { Policy } from '@/netguard/guard'
import type { EntryPatch, NewEntry } from '@/netguard/log'
import type { ScanProgress, ScanTarget } from './scanner'

export type ToWorker = {
  readonly type: 'start'
  readonly target: ScanTarget
  readonly policy: Policy
}

export type FromWorker =
  /** The worker's network log, merged into the main thread's (SPEC §8.1). */
  | { readonly type: 'net-entry'; readonly id: number; readonly entry: NewEntry }
  | { readonly type: 'net-update'; readonly id: number; readonly patch: EntryPatch }
  | { readonly type: 'progress'; readonly progress: ScanProgress }
  /** Another tab holds this Safe's lock and is scanning it. */
  | { readonly type: 'busy' }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly message: string }

/** Progress for other tabs, on a BroadcastChannel. */
export interface Broadcast {
  readonly key: string
  readonly progress: ScanProgress
}

export const CHANNEL = 'plainsafe:history'
export const lockName = (key: string) => `plainsafe:history:${key}`

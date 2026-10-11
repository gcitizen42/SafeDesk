// Runs history workers from the main thread (SPEC §11): one per Safe, its network log merged
// into the app's, its progress (and other tabs') shared through a small store.
import { netguard } from '@/netguard'
import { type HistoryCheckpoint, historyKey } from '@/schemas/history'
import type { Settings } from '@/schemas/settings'
import { type Broadcast, CHANNEL, type FromWorker, type ToWorker } from './protocol'
import type { ScanProgress, ScanTarget } from './scanner'

export interface HistoryState {
  readonly progress?: ScanProgress
  /** A worker in this tab is scanning. */
  readonly running: boolean
  /** Another tab holds the lock and is scanning. */
  readonly elsewhere: boolean
  readonly error?: string
}

const workers = new Map<string, Worker>()
let states: ReadonlyMap<string, HistoryState> = new Map()
const listeners = new Set<() => void>()

function replace(key: string, state: HistoryState) {
  states = new Map(states).set(key, state)
  for (const l of listeners) l()
}
const set = (key: string, patch: Partial<HistoryState>) =>
  replace(key, { ...(states.get(key) ?? { running: false, elsewhere: false }), ...patch })

export const historyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => states,
}

const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL)
if (channel)
  channel.onmessage = (ev: MessageEvent<Broadcast>) => {
    if (workers.has(ev.data.key)) return
    set(ev.data.key, {
      progress: ev.data.progress,
      elsewhere: ev.data.progress.status === 'scanning',
    })
  }

/** Where a Safe's history is read from: its chain's RPC URL. The wallet's RPC can't be used. */
export function historyTarget(settings: Settings, cp: HistoryCheckpoint): ScanTarget | undefined {
  const chain = settings.chains.find((c) => c.id === cp.chainId)
  if (chain?.rpc._tag !== 'url') return undefined
  return {
    chainId: cp.chainId,
    safe: cp.safe,
    version: cp.version,
    floor: BigInt(cp.floor ?? '0'),
    rpcUrl: chain.rpc.url,
  }
}

export function startHistory(target: ScanTarget) {
  const key = historyKey(target.chainId, target.safe)
  if (workers.has(key)) return
  const worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' })
  const logIds = new Map<number, number>()
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data
    switch (m.type) {
      case 'net-entry':
        logIds.set(m.id, netguard.log.add(m.entry))
        break
      case 'net-update': {
        const id = logIds.get(m.id)
        if (id !== undefined) netguard.log.update(id, m.patch)
        break
      }
      case 'progress':
        set(key, { progress: m.progress })
        break
      case 'busy':
        stop(key)
        set(key, { elsewhere: true })
        break
      case 'done':
        stop(key)
        break
      case 'error':
        stop(key)
        set(key, { error: m.message })
        break
    }
  }
  workers.set(key, worker)
  // A fresh run: keep the last progress, drop any old error
  const progress = states.get(key)?.progress
  replace(key, { running: true, elsewhere: false, ...(progress ? { progress } : {}) })
  worker.postMessage({ type: 'start', target, policy: netguard.getPolicy() } satisfies ToWorker)
}

function stop(key: string) {
  const w = workers.get(key)
  if (!w) return
  // Each chunk is committed in one transaction, so stopping anywhere is safe.
  w.terminate()
  workers.delete(key)
  set(key, { running: false })
}

export const stopHistory = (chainId: number, safe: string) => stop(historyKey(chainId, safe))

/** A new RPC or chain configuration: stop every scan; they restart with the new settings. */
export function stopAllHistory() {
  for (const key of [...workers.keys()]) stop(key)
}

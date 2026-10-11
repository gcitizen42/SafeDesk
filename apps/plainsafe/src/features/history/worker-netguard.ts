// netguard for the history worker (SPEC §8.1, §11): a worker has its own fetch, so it's guarded
// here, first, and every log entry is forwarded to the main thread's network log.
import { type GuardScope, installNetguard } from '@/netguard/guard'
import type { FromWorker } from './protocol'

export const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)

export const netguard = installNetguard(self as unknown as GuardScope, {
  source: 'history worker',
  onEntry: (entry, id) => post({ type: 'net-entry', id, entry }),
  onUpdate: (id, patch) => post({ type: 'net-update', id, patch }),
})

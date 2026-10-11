import { useSyncExternalStore } from 'react'
import { netguard } from '@/netguard'

export function useNetLog() {
  return useSyncExternalStore(netguard.log.subscribe, netguard.log.getSnapshot)
}

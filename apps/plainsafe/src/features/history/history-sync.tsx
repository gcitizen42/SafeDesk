// Keeps history scans going while the app is open (SPEC §11): a scan that hasn't finished
// resumes when the app starts, and every scan restarts when an RPC changes.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { checkpointsQuery } from '@/queries/history'
import { useLoadedSettings } from '@/queries/settings'
import { historyTarget, startHistory, stopAllHistory } from './manager'

export function HistorySync() {
  const settings = useLoadedSettings()
  const queryClient = useQueryClient()
  const rpcs = settings.chains
    .map((c) => `${c.id}=${c.rpc._tag === 'url' ? c.rpc.url : 'wallet'}`)
    .join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the RPCs change
  useEffect(() => {
    if (!settings.setupDone) return
    stopAllHistory()
    let cancelled = false
    void queryClient.fetchQuery(checkpointsQuery).then((cps) => {
      if (cancelled) return
      for (const cp of cps) {
        if (!cp.enabled || (cp.status !== undefined && cp.status !== 'scanning')) continue
        const target = historyTarget(settings, cp)
        if (target) startHistory(target)
      }
    })
    return () => {
      cancelled = true
    }
  }, [rpcs, settings.setupDone])
  return null
}

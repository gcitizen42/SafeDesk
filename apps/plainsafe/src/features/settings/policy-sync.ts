// Keeps netguard's allowlist and the Rpc service in step with settings, plus origins the user
// deliberately tested this session (SPEC §3.1: the Test button makes the first request).
import { useEffect } from 'react'
import { setRpcChains } from '@/effect/rpc'
import { netguard } from '@/netguard'
import type { Settings } from '@/schemas/settings'
import { policyFromSettings } from './policy'

const grants = new Set<string>()
let current: Settings | undefined

const apply = () => netguard.setPolicy(policyFromSettings(current, grants))

/** Allow one origin for this session, after an explicit user action. */
export function grantOrigin(origin: string) {
  grants.add(origin)
  apply()
}

/** End a one-off grant (for example "fetch this token list once"). */
export function revokeGrant(origin: string) {
  grants.delete(origin)
  apply()
}

/**
 * Apply saved settings now. Called right after saving, so the next screen's reads don't race
 * the query cache update.
 */
export function applySettingsPolicy(settings: Settings | undefined) {
  // When setup is first saved, drop the setup screen's test grants: from then on the allowlist
  // comes from settings (plus any later explicit, one-off grants).
  if (settings?.setupDone && !current?.setupDone) grants.clear()
  current = settings
  setRpcChains(settings?.chains ?? [])
  apply()
}

export function usePolicySync(settings: Settings | undefined) {
  useEffect(() => applySettingsPolicy(settings), [settings])
}

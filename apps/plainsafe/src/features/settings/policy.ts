// The netguard allowlist, computed from settings (SPEC §8.1).
import { originOf, type Policy } from '@/netguard/guard'
import type { Settings } from '@/schemas/settings'
import { CAPABILITIES } from './capabilities'

/**
 * - Before setup is done, nothing from settings is allowed: only origins the user deliberately
 *   tested on the setup screen this session (`grants`).
 * - After setup: each chain's RPC origin, plus the hosts of enabled capabilities.
 */
export function policyFromSettings(
  settings: Settings | undefined,
  grants: Iterable<string> = [],
): Policy {
  const origins = new Set(grants)
  if (!settings?.setupDone) return { origins: [...origins].sort(), ccipRead: false }
  for (const chain of settings.chains) {
    const origin = chain.rpc._tag === 'url' ? originOf(chain.rpc.url) : undefined
    if (origin) origins.add(origin)
  }
  for (const cap of CAPABILITIES) {
    if (settings.capabilities[cap.key]) for (const o of cap.origins) origins.add(o)
  }
  for (const o of settings.capabilities.tokenListOrigins) origins.add(o)
  return { origins: [...origins].sort(), ccipRead: settings.capabilities.ccipRead }
}

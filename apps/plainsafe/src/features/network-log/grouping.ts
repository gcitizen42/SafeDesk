// The network log grouped by host (SPEC §8.1): who the app talked to, why each host is allowed
// (or why it was blocked), and the requests to it, newest first. Pure, so it's tested directly.
import { CAPABILITIES } from '@/features/settings/capabilities'
import { list } from '@/lib/format'
import type { LogEntry } from '@/netguard/log'
import type { Settings } from '@/schemas/settings'

/** Plain words for the tag each part of the app puts on its requests. */
const TAG_LABELS: Readonly<Record<string, string>> = {
  safe: 'Safe',
  balances: 'Balances',
  prices: 'Prices',
  ens: 'ENS names',
  'ccip-read': 'ENS gateway',
  'token-meta': 'Token details',
  tokenlist: 'Token list',
  whatsabi: 'Contract check',
  sourcify: 'Sourcify ABI',
  'signature-db': 'Function names',
  'clear-signing': 'Clear signing',
  simulation: 'Simulation',
  approvals: 'Approvals',
  execute: 'Execution',
  history: 'Onchain history',
  swap: 'Swap',
  create: 'Create a Safe',
  untagged: 'Unlabeled',
}

/** A batch shared by several parts of the app carries all their tags: "ens+safe" → "ENS names + Safe". */
export const tagLabel = (tag: string) =>
  tag
    .split('+')
    .map((t) => TAG_LABELS[t] ?? t)
    .join(' + ')

export interface HostRole {
  /** Why this host is allowed, or why it was blocked. */
  readonly label: string
  readonly kind: 'rpc' | 'capability' | 'tokenlist' | 'ccip' | 'blocked' | 'other'
}

export interface HostGroup {
  readonly host: string
  readonly role: HostRole
  /** Newest first. */
  readonly entries: readonly LogEntry[]
  /** JSON-RPC calls across all requests (a batch counts each call). */
  readonly calls: number
  readonly blocked: number
  readonly failed: number
  readonly last: number
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** Your RPCs, by host: "Ethereum" or "Ethereum and Sepolia" when chains share one. */
function rpcHosts(settings: Settings): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const c of settings.chains) {
    if (c.rpc._tag !== 'url') continue
    const host = hostOf(c.rpc.url)
    if (host) out.set(host, [...(out.get(host) ?? []), c.name])
  }
  return out
}

const rpcRole = (chains: readonly string[]): HostRole => ({
  kind: 'rpc',
  label: `Your ${list(chains)} RPC`,
})

export function hostRole(host: string, entries: readonly LogEntry[], settings: Settings): HostRole {
  const rpc = rpcHosts(settings).get(host)
  const capability = CAPABILITIES.find((c) => c.origins.some((o) => hostOf(o) === host))
  const anyBlocked = entries.some((e) => e.outcome === 'blocked')
  const allBlocked = entries.length > 0 && entries.every((e) => e.outcome === 'blocked')
  if (rpc) return rpcRole(rpc)
  if (allBlocked || (anyBlocked && !capability)) {
    if (capability && !settings.capabilities[capability.key])
      return { kind: 'blocked', label: `Blocked: ${capability.label} is off in Network access` }
    return { kind: 'blocked', label: 'Blocked: not in the allowlist' }
  }
  if (capability) return { kind: 'capability', label: `${capability.label}, from Network access` }
  if (entries.some((e) => e.tag === 'ccip-read'))
    return { kind: 'ccip', label: 'ENS gateway a name points to (CCIP-read)' }
  if (settings.capabilities.tokenListOrigins.some((o) => hostOf(o) === host))
    return { kind: 'tokenlist', label: 'Token list host you always allow' }
  if (entries.some((e) => e.tag === 'tokenlist'))
    return { kind: 'tokenlist', label: 'Token list host you allowed once' }
  return { kind: 'other', label: 'Allowed' }
}

/**
 * Entries grouped by host: hosts with blocked requests first, then the most recently used.
 * `idle` lists your RPC hosts the log hasn't seen yet.
 */
export function groupByHost(
  entries: readonly LogEntry[],
  settings: Settings,
): { groups: HostGroup[]; idle: { host: string; role: HostRole }[] } {
  const byHost = new Map<string, LogEntry[]>()
  for (const e of entries) byHost.set(e.host, [...(byHost.get(e.host) ?? []), e])
  const groups = [...byHost].map(([host, list]): HostGroup => {
    const newest = [...list].sort((a, b) => b.time - a.time || b.id - a.id)
    return {
      host,
      role: hostRole(host, list, settings),
      entries: newest,
      calls: list.reduce((n, e) => n + e.methods.length, 0),
      blocked: list.filter((e) => e.outcome === 'blocked').length,
      failed: list.filter((e) => e.outcome === 'failed').length,
      last: newest[0]?.time ?? 0,
    }
  })
  groups.sort((a, b) => Number(b.blocked > 0) - Number(a.blocked > 0) || b.last - a.last)
  const idle = [...rpcHosts(settings)]
    .filter(([host]) => !byHost.has(host))
    .map(([host, chains]) => ({ host, role: rpcRole(chains) }))
  return { groups, idle }
}

/** "eth_call ×7, eth_getCode" */
export function summarizeMethods(methods: readonly string[]) {
  const counts = new Map<string, number>()
  for (const m of methods) counts.set(m, (counts.get(m) ?? 0) + 1)
  return [...counts].map(([m, n]) => (n > 1 ? `${m} ×${n}` : m)).join(', ')
}

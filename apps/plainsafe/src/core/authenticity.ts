// Safe authenticity by code hash (SPEC §4.2). Works on any chain: no per-chain address tables.
// VERSION() is informational only; the singleton's code hash decides the version.
import { type Address, type Hex, keccak256 } from 'viem'

export interface SingletonInfo {
  readonly contractName: string
  readonly version: string
  readonly variant: string
  readonly l2: boolean
  readonly supported: boolean
  readonly codeHash: Hex
}

export interface ProxyInfo {
  readonly codeHash: Hex
  readonly size: number
  /** e.g. "1.3.0 canonical": which factories create this proxy code. */
  readonly factories: readonly string[]
}

export interface DeploymentTables {
  readonly singletons: readonly SingletonInfo[]
  readonly proxies: readonly ProxyInfo[]
}

export type Authenticity =
  | {
      readonly status: 'verified'
      readonly version: string
      readonly l2: boolean
      readonly singleton: Address
      readonly singletonName: string
      readonly proxy: ProxyInfo
      /** Set when VERSION() disagrees with the version from the code hash. */
      readonly versionMismatch?: string
    }
  | { readonly status: 'not-a-contract' }
  | { readonly status: 'unknown-proxy'; readonly codeHash: Hex }
  | { readonly status: 'unknown-singleton'; readonly singleton: Address; readonly codeHash: Hex }
  | {
      readonly status: 'unsupported-version'
      readonly version: string
      readonly singleton: Address
    }

interface AuthenticityInput {
  readonly proxyCode: Hex | undefined
  readonly singleton: Address
  readonly singletonCode: Hex | undefined
  /** What VERSION() returned, if anything. Never trusted. */
  readonly reportedVersion?: string
}

export function checkAuthenticity(
  tables: DeploymentTables,
  input: AuthenticityInput,
): Authenticity {
  const { proxyCode, singletonCode } = input
  if (!proxyCode || proxyCode === '0x') return { status: 'not-a-contract' }
  // keccak256 returns lowercase hex
  const proxyHash = keccak256(proxyCode)
  const proxy = tables.proxies.find((p) => p.codeHash.toLowerCase() === proxyHash)
  if (!proxy) return { status: 'unknown-proxy', codeHash: proxyHash }

  if (!singletonCode || singletonCode === '0x') {
    return { status: 'unknown-singleton', singleton: input.singleton, codeHash: keccak256('0x') }
  }
  const singletonHash = keccak256(singletonCode)
  const singleton = tables.singletons.find((s) => s.codeHash.toLowerCase() === singletonHash)
  if (!singleton) {
    return { status: 'unknown-singleton', singleton: input.singleton, codeHash: singletonHash }
  }
  if (!singleton.supported) {
    return { status: 'unsupported-version', version: singleton.version, singleton: input.singleton }
  }
  const mismatch =
    input.reportedVersion !== undefined && input.reportedVersion !== singleton.version
      ? input.reportedVersion
      : undefined
  return {
    status: 'verified',
    version: singleton.version,
    l2: singleton.l2,
    singleton: input.singleton,
    singletonName: singleton.contractName,
    proxy,
    ...(mismatch !== undefined ? { versionMismatch: mismatch } : {}),
  }
}

/** Plain-language reason for a Safe that can't be signed for (SPEC §3.2: read-only). */
export function authenticityReason(a: Authenticity): string | undefined {
  switch (a.status) {
    case 'verified':
      return undefined
    case 'not-a-contract':
      return 'There is no contract at this address on this chain.'
    case 'unknown-proxy':
      return "This contract's code doesn't match any Safe proxy. It may not be a Safe."
    case 'unknown-singleton':
      return "This Safe's implementation (singleton) doesn't match any known Safe release. It could be a newer version this app doesn't know yet, or a fake. Signing is disabled."
    case 'unsupported-version':
      return `Safe v${a.version} is not supported (v1.3.0 or later is needed). It is shown read-only.`
  }
}

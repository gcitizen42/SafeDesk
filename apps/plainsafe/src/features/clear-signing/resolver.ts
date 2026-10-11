// The DescriptorResolver (SPEC §7.2): bundled Safe descriptors, hash-verified downloads from the
// pinned registry commit (only with the capability on), and user-imported descriptors. The
// library's default GitHub resolver is never used.
import type {
  Descriptor,
  DescriptorDeployment,
  DescriptorResolver,
  RegistryIndex,
} from '@ethereum-sourcify/clear-signing'
import type { Address } from 'viem'

interface Pinned<T> {
  readonly repo: string
  readonly commit: string
  readonly files: Record<string, T>
}

let bundle: Promise<Pinned<unknown>> | undefined
let manifest: Promise<Pinned<string>> | undefined
/** Lazily loaded chunks from the app's own origin. */
export const loadBundle = () =>
  (bundle ??= import('@/generated/clear-signing/bundle.json').then(
    (m) => m.default as Pinned<unknown>,
  ))
const loadManifest = () =>
  (manifest ??= import('@/generated/clear-signing/manifest.json').then(
    (m) => m.default as Pinned<string>,
  ))

const verified = new Map<string, Promise<unknown>>()

/** Lowercase hex, without 0x: how the manifest and imported descriptors' ids write it. */
export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Where verified downloads are kept between sessions (a rebuildable cache, SPEC §9.5). */
export interface DescriptorCache {
  /** The cached file's text for this SHA-256, if any. */
  readonly get: (sha256: string) => Promise<string | undefined>
  readonly put: (sha256: string, path: string, text: string) => Promise<void>
}

/**
 * A registry file at the pinned commit, from the cache or raw.githubusercontent.com. Either way
 * it's dropped unless its SHA-256 matches the manifest, so a tampered cache is caught too.
 */
export function fetchVerified(path: string, cache?: DescriptorCache): Promise<unknown> {
  let p = verified.get(path)
  if (!p) {
    p = (async () => {
      const m = await loadManifest()
      const expected = m.files[path]
      if (!expected) throw new Error(`${path} is not in the pinned registry manifest`)
      const cached = await cache?.get(expected).catch(() => undefined)
      if (cached !== undefined) {
        const bytes = new TextEncoder().encode(cached)
        if ((await sha256Hex(bytes)) === expected) return JSON.parse(cached)
      }
      // Imported here so this module stays usable outside the browser (tests).
      const { netguard } = await import('@/netguard')
      const res = await netguard.fetchFor('clear-signing')(
        `https://raw.githubusercontent.com/${m.repo}/${m.commit}/${path}`,
      )
      if (!res.ok)
        throw new Error(`raw.githubusercontent.com answered HTTP ${res.status} for ${path}`)
      const bytes = await res.arrayBuffer()
      if ((await sha256Hex(bytes)) !== expected)
        throw new Error(`${path} failed its SHA-256 check and was dropped`)
      const text = new TextDecoder().decode(bytes)
      await cache?.put(expected, path, text).catch(() => undefined)
      return JSON.parse(text)
    })()
    p.catch(() => verified.delete(path))
    verified.set(path, p)
  }
  return p
}

/** Where a descriptor used in a rendering came from. */
export type DescriptorSource =
  | { readonly kind: 'bundled'; readonly path: string }
  | { readonly kind: 'registry'; readonly path: string }
  | { readonly kind: 'user'; readonly id: string; readonly name: string }

export interface SafeContext {
  readonly chainId: number
  readonly safe: Address
  /** From the singleton's code hash (SPEC §4.2), never from VERSION(). */
  readonly version: string
  readonly l2: boolean
}

export interface UserDescriptor {
  readonly id: string
  readonly name: string
  readonly descriptor: Descriptor
}

const SAFE_TX_TYPEHASH = '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8'

const withDeployment = (
  descriptor: Descriptor,
  kind: 'contract' | 'eip712',
  d: DescriptorDeployment,
): Descriptor => {
  const copy = structuredClone(descriptor)
  const section = copy.context?.[kind] ?? {}
  copy.context = {
    ...copy.context,
    [kind]: { ...section, deployments: [...(section.deployments ?? []), d] },
  }
  return copy
}

export async function makeResolver(
  ctx: SafeContext,
  options: {
    remote: boolean
    userDescriptors: readonly UserDescriptor[]
    cache?: DescriptorCache | undefined
    /** Called with each descriptor the library asks for. */
    onUse: (source: DescriptorSource) => void
  },
): Promise<DescriptorResolver> {
  const fetchRegistry = (path: string) => fetchVerified(path, options.cache)
  const files = (await loadBundle()).files
  const base: RegistryIndex = { calldataIndex: {}, typedDataIndex: {} }
  if (options.remote) {
    try {
      const [calldata, eip712] = await Promise.all([
        fetchRegistry('index.calldata.json'),
        fetchRegistry('index.eip712.json'),
      ])
      Object.assign(base.calldataIndex, calldata)
      Object.assign(base.typedDataIndex, eip712)
    } catch {
      // Without the index, only bundled and user descriptors resolve.
    }
  }
  // User descriptors, keyed by their own deployments
  for (const u of options.userDescriptors) {
    for (const d of u.descriptor.context?.contract?.deployments ?? [])
      if (d.chainId !== undefined && d.address)
        base.calldataIndex[`eip155:${d.chainId}:${d.address.toLowerCase()}`] = `user:${u.id}`
  }
  // SPEC §7.2: a call from the Safe to itself has `to` = the proxy, so the proxy maps to the Safe
  // descriptor for its code-hash-verified version, on any chain.
  const name = ctx.l2 ? 'SafeL2' : 'Safe'
  const proxyKey = `eip155:${ctx.chainId}:${ctx.safe.toLowerCase()}`
  const calldataPath = `registry/safe/calldata-${name}-${ctx.version}.json`
  const typedPath = `registry/safe/eip712-${name}-${ctx.version}.json`
  if (files[calldataPath]) base.calldataIndex[proxyKey] = calldataPath
  if (files[typedPath])
    base.typedDataIndex[proxyKey] = {
      SafeTx: [{ path: typedPath, encodeTypeHashes: [SAFE_TX_TYPEHASH] }],
    }

  const deployment = { chainId: ctx.chainId, address: ctx.safe }
  return {
    index: base,
    fetchDescriptor: async (path) => {
      if (path.startsWith('user:')) {
        const u = options.userDescriptors.find((x) => `user:${x.id}` === path)
        if (!u) throw new Error(`Missing user descriptor ${path}`)
        options.onUse({ kind: 'user', id: u.id, name: u.name })
        return u.descriptor
      }
      const bundled = files[path] as Descriptor | undefined
      if (bundled) {
        options.onUse({ kind: 'bundled', path })
        if (path === calldataPath) return withDeployment(bundled, 'contract', deployment)
        if (path === typedPath) return withDeployment(bundled, 'eip712', deployment)
        return bundled
      }
      if (!options.remote)
        throw new Error(`${path} isn't bundled; turn on "Clear-signing descriptors" to fetch it`)
      const descriptor = (await fetchRegistry(path)) as Descriptor
      options.onUse({ kind: 'registry', path })
      return descriptor
    },
  }
}

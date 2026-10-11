// Generates src/generated/safe-deployments.json (SPEC §4.2):
// - singleton, MultiSend, MultiSendCallOnly and SimulateTxAccessor code hashes from safe-deployments
// - proxy runtime code hashes, derived from each factory's proxyCreationCode() (safe-deployments
//   lists factory hashes, not the hashes of the proxies they create)
// - each singleton's deploy block on Mainnet and Sepolia (the floor for onchain history, §11)
// - proxy factories (with their proxyCreationCode) and fallback handlers, for creating a Safe (§3.14)
//
// Run: bun run gen:safe-deployments   (MAINNET_RPC_URL / SEPOLIA_RPC_URL override the defaults)
// The output is deterministic: no timestamps, sorted entries.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
} from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// Pinned source. Update deliberately; the tag and commit are shown in About.
const SOURCE = {
  repo: 'safe-global/safe-deployments',
  tag: 'v1.37.63',
  commit: '91cc318928826ea91357dc93b967480d7a79c2a1',
} as const
const BASE = `https://raw.githubusercontent.com/${SOURCE.repo}/${SOURCE.commit}/src/assets`

const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? 'https://rpc.mevblocker.io'
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? 'https://evm.stupidtech.net/v1/11155111'
const OUT = new URL('../src/generated/safe-deployments.json', import.meta.url)

type Variant = 'canonical' | 'eip155' | 'zksync'
interface Deployment {
  contractName: string
  version: string
  deployments: Partial<Record<Variant, { address: Address; codeHash: Hex }>>
  networkAddresses: Record<string, Variant | Variant[]>
}

const SUPPORTED = new Set(['1.3.0', '1.4.1', '1.5.0'])

// [version, file] for each contract kind. Versions before 1.3.0 are included so the app can say
// "unsupported version" rather than "unknown singleton" (SPEC §4.1).
const SINGLETONS = [
  ['1.0.0', 'gnosis_safe.json'],
  ['1.1.1', 'gnosis_safe.json'],
  ['1.2.0', 'gnosis_safe.json'],
  ['1.3.0', 'gnosis_safe.json'],
  ['1.3.0', 'gnosis_safe_l2.json'],
  ['1.4.1', 'safe.json'],
  ['1.4.1', 'safe_l2.json'],
  ['1.5.0', 'safe.json'],
  ['1.5.0', 'safe_l2.json'],
] as const
const FACTORIES = [
  ['1.0.0', 'proxy_factory.json'],
  ['1.1.1', 'proxy_factory.json'],
  ['1.3.0', 'proxy_factory.json'],
  ['1.4.1', 'safe_proxy_factory.json'],
  ['1.5.0', 'safe_proxy_factory.json'],
] as const
const MULTI_SEND = [
  ['1.1.1', 'multi_send.json'],
  ['1.3.0', 'multi_send.json'],
  ['1.4.1', 'multi_send.json'],
  ['1.5.0', 'multi_send.json'],
] as const
const MULTI_SEND_CALL_ONLY = [
  ['1.3.0', 'multi_send_call_only.json'],
  ['1.4.1', 'multi_send_call_only.json'],
  ['1.5.0', 'multi_send_call_only.json'],
] as const
const FALLBACK_HANDLERS = [
  ['1.3.0', 'compatibility_fallback_handler.json'],
  ['1.4.1', 'compatibility_fallback_handler.json'],
  ['1.5.0', 'compatibility_fallback_handler.json'],
] as const
const ACCESSORS = [
  ['1.3.0', 'simulate_tx_accessor.json'],
  ['1.4.1', 'simulate_tx_accessor.json'],
  ['1.5.0', 'simulate_tx_accessor.json'],
] as const

const cache = new Map<string, Promise<Deployment>>()
function load(version: string, file: string): Promise<Deployment> {
  const url = `${BASE}/v${version}/${file}`
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${version}/${file}: HTTP ${res.status}`)
      return res.json() as Promise<Deployment>
    })
    cache.set(url, p)
  }
  return p
}

const variantsOn = (d: Deployment, chainId: number): Variant[] => {
  const v = d.networkAddresses[String(chainId)]
  return v === undefined ? [] : Array.isArray(v) ? v : [v]
}

interface Entry {
  contractName: string
  version: string
  variant: Variant
  address: Address
  codeHash: Hex
  /** Chains where safe-deployments lists this variant (used here only, not written out). */
  chains: { mainnet: boolean; sepolia: boolean }
}

const publicEntry = ({ chains: _, ...e }: Entry) => e

async function entries(list: readonly (readonly [string, string])[]): Promise<Entry[]> {
  const out: Entry[] = []
  for (const [version, file] of list) {
    const d = await load(version, file)
    for (const [variant, dep] of Object.entries(d.deployments) as [
      Variant,
      { address: Address; codeHash: Hex },
    ][]) {
      out.push({
        contractName: d.contractName,
        version,
        variant,
        address: getAddress(dep.address),
        codeHash: dep.codeHash.toLowerCase() as Hex,
        chains: {
          mainnet: variantsOn(d, 1).includes(variant),
          sepolia: variantsOn(d, 11155111).includes(variant),
        },
      })
    }
  }
  return out
}

// Public RPCs rate-limit bursts (MEV Blocker's Cloudflare returns 1015 bans), so pace requests.
const PACE_MS = Number(process.env.PACE_MS ?? 400)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function withRetry<T>(what: string, f: () => Promise<T>, tries = 6): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      await sleep(PACE_MS)
      return await f()
    } catch (e) {
      last = e
      if (i + 1 < tries) await sleep(2000 * 2 ** i)
    }
  }
  throw new Error(`${what}: ${String(last)}`)
}

const factoryAbi = parseAbi([
  'function proxyCreationCode() pure returns (bytes)',
  'function proxyRuntimeCode() pure returns (bytes)',
])
const DUMMY_SINGLETON: Address = '0x1111111111111111111111111111111111111111'

/**
 * Proxy runtime code hash: run proxyCreationCode ‖ abi.encode(singleton) as a creation eth_call.
 * Also returns each factory's proxyCreationCode, which creating a Safe needs for the CREATE2
 * address (SPEC §3.14).
 */
async function deriveProxies(client: PublicClient) {
  const factories = await entries(FACTORIES)
  const found = new Map<Hex, { codeHash: Hex; size: number; factories: string[] }>()
  const creationCodes = new Map<Address, Hex>()
  for (const f of factories) {
    if (!f.chains.mainnet) continue
    const creation = await withRetry(`proxyCreationCode ${f.address}`, () =>
      client.readContract({
        address: f.address,
        abi: factoryAbi,
        functionName: 'proxyCreationCode',
      }),
    )
    creationCodes.set(f.address, creation)
    const data =
      `${creation}${encodeAbiParameters([{ type: 'address' }], [DUMMY_SINGLETON]).slice(2)}` as Hex
    const { data: runtime } = await withRetry(`creation call ${f.address}`, () =>
      client.call({ data }),
    )
    if (!runtime) throw new Error(`no runtime code from ${f.address}`)
    const codeHash = keccak256(runtime)
    const size = (runtime.length - 2) / 2
    if (runtime.toLowerCase().includes(DUMMY_SINGLETON.slice(2))) {
      throw new Error(`proxy runtime from ${f.address} embeds the singleton; its hash would vary`)
    }
    // v1.0.0–1.3.0 factories also expose proxyRuntimeCode(): cross-check (SPEC §4.2)
    const rt = await client
      .readContract({ address: f.address, abi: factoryAbi, functionName: 'proxyRuntimeCode' })
      .catch(() => undefined)
    if (rt !== undefined && keccak256(rt) !== codeHash)
      throw new Error(`proxyRuntimeCode() differs for ${f.address}`)
    const label = `${f.version} ${f.variant}`
    const prev = found.get(codeHash)
    if (prev) prev.factories.push(label)
    else found.set(codeHash, { codeHash, size, factories: [label] })
    console.log(`proxy from ${label} factory: ${codeHash} (${size} bytes)`)
  }
  return {
    proxies: [...found.values()].sort((a, b) => a.codeHash.localeCompare(b.codeHash)),
    factories: byHash(
      factories.map((f) => {
        const proxyCreationCode = creationCodes.get(f.address)
        return { ...publicEntry(f), ...(proxyCreationCode ? { proxyCreationCode } : {}) }
      }),
    ),
  }
}

/** First block at which `address` has code (binary search on historical eth_getCode). */
async function deployBlock(client: PublicClient, address: Address, head: bigint): Promise<string> {
  const hasCode = async (block: bigint) =>
    ((await withRetry(`getCode ${address}@${block}`, () =>
      client.getCode({ address, blockNumber: block }),
    )) ?? '0x') !== '0x'
  if (!(await hasCode(head))) throw new Error(`${address} has no code at head`)
  let lo = 0n
  let hi = head
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    if (await hasCode(mid)) hi = mid
    else lo = mid + 1n
  }
  return lo.toString()
}

/** Deploy blocks never change, so values from the previous output are reused. */
function previousDeployBlocks(chainId: number): Record<string, string> {
  if (!existsSync(OUT)) return {}
  const prev = JSON.parse(readFileSync(OUT, 'utf8')) as {
    deployBlocks?: Record<string, Record<string, string>>
  }
  return prev.deployBlocks?.[chainId] ?? {}
}

async function deployBlocks(
  client: PublicClient,
  chain: 'mainnet' | 'sepolia',
  singletons: Entry[],
) {
  const head = await withRetry('blockNumber', () => client.getBlockNumber())
  const previous = previousDeployBlocks(chain === 'mainnet' ? mainnet.id : sepolia.id)
  const out: Record<string, string> = {}
  for (const s of singletons) {
    if (!SUPPORTED.has(s.version) || !s.chains[chain]) continue
    const key = s.address.toLowerCase()
    if (out[key]) continue
    out[key] = previous[key] ?? (await deployBlock(client, s.address, head))
    console.log(
      `${chain}: ${s.contractName} ${s.version} ${s.variant} ${s.address} deployed at ${out[key]}`,
    )
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

const byHash = <T extends { codeHash: string; version: string; variant: string }>(list: T[]) =>
  [...list].sort(
    (a, b) =>
      a.version.localeCompare(b.version) ||
      a.variant.localeCompare(b.variant) ||
      a.codeHash.localeCompare(b.codeHash),
  )

async function main() {
  const mainnetClient = createPublicClient({
    chain: mainnet,
    transport: http(MAINNET_RPC, { retryCount: 0 }),
  })
  const sepoliaClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC, { retryCount: 0 }),
  })

  const singletons = await entries(SINGLETONS)
  const derived = await deriveProxies(mainnetClient as PublicClient)
  const result = {
    source: SOURCE,
    supportedVersions: [...SUPPORTED],
    singletons: byHash(
      singletons.map((s) => ({
        ...publicEntry(s),
        l2: s.contractName.endsWith('L2'),
        supported: SUPPORTED.has(s.version),
      })),
    ),
    multiSend: byHash((await entries(MULTI_SEND)).map(publicEntry)),
    multiSendCallOnly: byHash((await entries(MULTI_SEND_CALL_ONLY)).map(publicEntry)),
    simulateTxAccessor: byHash((await entries(ACCESSORS)).map(publicEntry)),
    proxies: derived.proxies,
    // For creating a Safe (SPEC §3.14): each checked by code hash on the chain before use
    proxyFactories: derived.factories,
    fallbackHandlers: byHash((await entries(FALLBACK_HANDLERS)).map(publicEntry)),
    deployBlocks: {
      [mainnet.id]: await deployBlocks(mainnetClient as PublicClient, 'mainnet', singletons),
      [sepolia.id]: await deployBlocks(sepoliaClient as PublicClient, 'sepolia', singletons),
    },
  }
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`wrote ${OUT.pathname}`)
}

await main()

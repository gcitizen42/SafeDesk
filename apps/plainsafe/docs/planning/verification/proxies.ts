// Derive Safe proxy runtime code hashes from each factory's proxyCreationCode(), and
// compare with real Safes' code hashes. Also collects sample Safes per singleton version.
import {
  type Address,
  type Hex,
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
} from 'viem'
import { mainnet } from 'viem/chains'

const client = createPublicClient({ chain: mainnet, transport: http('https://rpc.mevblocker.io') })

const factories: Record<string, Address> = {
  'v1.0.0': '0x12302fE9c02ff50939BaAaaf415fc226C078613C',
  'v1.1.1': '0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B',
  'v1.3.0': '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  'v1.4.1': '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  'v1.5.0': '0x14F2982D601c9458F93bd70B218933A6f8165e7b',
}
const abi = parseAbi([
  'function proxyCreationCode() pure returns (bytes)',
  'function proxyRuntimeCode() pure returns (bytes)',
])
const dummySingleton: Address = '0x1111111111111111111111111111111111111111'

const proxyHashes: Record<string, string> = {}
for (const [v, f] of Object.entries(factories)) {
  const creation = await client.readContract({ address: f, abi, functionName: 'proxyCreationCode' })
  const data = (creation + encodeAbiParameters([{ type: 'address' }], [dummySingleton]).slice(2)) as Hex
  const { data: runtime } = await client.call({ data })
  const h = keccak256(runtime!)
  let rt = ''
  try {
    const r = await client.readContract({ address: f, abi, functionName: 'proxyRuntimeCode' })
    rt = keccak256(r) === h ? 'matches proxyRuntimeCode()' : `DIFFERS from proxyRuntimeCode() ${keccak256(r)}`
  } catch {
    rt = 'no proxyRuntimeCode()'
  }
  proxyHashes[h] = v
  console.log(`${v} factory → proxy runtime ${runtime!.length / 2 - 1} bytes, hash ${h} (${rt})`)
}

// Find recent Safes created by the 1.4.1 and 1.5.0 factories (indexed proxy topic)
const head = await client.getBlockNumber()
const ev = parseAbiItem('event ProxyCreation(address indexed proxy, address singleton)')
for (const v of ['v1.4.1', 'v1.5.0'] as const) {
  let found: Address[] = []
  for (let back = 50_000n; back <= 2_000_000n && found.length === 0; back *= 4n) {
    const logs = await client.getLogs({ address: factories[v], event: ev, fromBlock: head - back, toBlock: head })
    found = logs.slice(-5).map((l) => l.args.proxy!)
  }
  console.log(`${v} sample proxies:`, found.join(' '))
}

// Code hash of a known 1.3.0-era Safe (ENS Endowment)
const ens = '0x4F2083f5fBede34C2714aFfb3105539775f7FE64'
const code = await client.getCode({ address: ens })
console.log(`ENS Endowment proxy hash ${keccak256(code!)} → ${proxyHashes[keccak256(code!)] ?? 'UNKNOWN'}`)
console.log(JSON.stringify(proxyHashes))

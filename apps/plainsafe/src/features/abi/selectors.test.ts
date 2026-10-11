import { whatsabi } from '@shazow/whatsabi'
import { type Address, getAddress, type Hex, keccak256, pad, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { deployments } from '@/core/deployments'
import { selectorsOf } from './selectors'
import {
  multiSendCallOnly141Code,
  proxyFactory141Code,
  safeProxy130Code,
} from './selectors.fixtures'

const FACTORY: Address = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'
const SAFE: Address = '0xeE9eeaAB0Bb7D9B969D701f6f8212609EDeA252E'
const SINGLETON: Address = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'

/** An RPC over fixed code and slot-0 storage, the way whatsabi reads a chain. */
const chainOf = (code: Record<string, Hex>, slot0: Record<string, Address> = {}) =>
  whatsabi.providers.CompatibleProvider({
    request: async ({ method, params }: { method: string; params: readonly string[] }) => {
      const address = (params[0] ?? '').toLowerCase()
      if (method === 'eth_getCode') return code[address] ?? '0x'
      if (method === 'eth_getStorageAt') {
        const value = BigInt(params[1] ?? '0x0') === 0n ? slot0[address] : undefined
        return pad(value ?? '0x0')
      }
      throw new Error(`unexpected ${method}`)
    },
  })

/** What inspectContract does with whatsabi (SPEC §7.3), minus the RPC plumbing. */
async function inspect(chain: Record<string, Hex>, slot0: Record<string, Address>, to: Address) {
  const code = Object.fromEntries(Object.entries(chain).map(([a, c]) => [a.toLowerCase(), c]))
  const loaded = await whatsabi.autoload(to, {
    provider: chainOf(code, slot0),
    abiLoader: false,
    signatureLookup: false,
    followProxies: true,
    onError: () => false,
  })
  const implementation = getAddress(loaded.address)
  return {
    loaded,
    implementation,
    isProxy: implementation !== to,
    selectors: selectorsOf(loaded, code[implementation.toLowerCase()]),
  }
}

const factorySelectors = [
  'createProxyWithNonce(address,bytes,uint256)',
  'getChainId()',
  'proxyCreationCode()',
  'createProxyWithCallback(address,bytes,uint256,address)',
  'createChainSpecificProxyWithNonce(address,bytes,uint256)',
]
  .map((s) => toFunctionSelector(`function ${s}`))
  .sort()

describe('selectorsOf', () => {
  it('uses fixtures with the code hashes in the bundled safe-deployments table', () => {
    const hashes = (list: readonly { codeHash: Hex }[]) => list.map((c) => c.codeHash)
    expect(hashes(deployments.proxyFactories)).toContain(keccak256(proxyFactory141Code))
    expect(hashes(deployments.proxies)).toContain(keccak256(safeProxy130Code))
    expect(hashes(deployments.multiSendCallOnly)).toContain(keccak256(multiSendCallOnly141Code))
  })

  it("reads the Safe ProxyFactory's own jump table when whatsabi mistakes it for a proxy", async () => {
    const r = await inspect({ [FACTORY]: proxyFactory141Code }, {}, FACTORY)
    // whatsabi 0.29: sees the embedded GnosisSafeProxy, can't follow it, returns no ABI
    expect(r.loaded.proxies.map((p) => p.name)).toEqual(['GnosisSafeProxy'])
    expect(r.loaded.abi).toEqual([])
    expect(r.implementation).toBe(FACTORY)
    expect(r.isProxy).toBe(false)
    expect(r.selectors).toEqual(factorySelectors)
    expect(r.selectors).toContain('0x1688f0b9') // createProxyWithNonce
  })

  it("follows a Safe proxy to its singleton and keeps whatsabi's selectors", async () => {
    const r = await inspect(
      { [SAFE]: safeProxy130Code, [SINGLETON]: multiSendCallOnly141Code },
      { [SAFE.toLowerCase()]: SINGLETON },
      SAFE,
    )
    expect(r.implementation).toBe(SINGLETON)
    expect(r.isProxy).toBe(true)
    expect(r.selectors).toEqual([toFunctionSelector('function multiSend(bytes)')])
  })

  it("reads the implementation's jump table when whatsabi stops at a factory behind a proxy", async () => {
    const r = await inspect(
      { [SAFE]: safeProxy130Code, [FACTORY]: proxyFactory141Code },
      { [SAFE.toLowerCase()]: FACTORY },
      SAFE,
    )
    expect(r.implementation).toBe(FACTORY)
    expect(r.isProxy).toBe(true)
    expect(r.selectors).toEqual(factorySelectors)
  })

  it('finds nothing when there is no code', () => {
    expect(selectorsOf({ abi: [] }, undefined)).toEqual([])
    expect(selectorsOf({ abi: [] }, '0x')).toEqual([])
  })

  it("dedupes and sorts whatsabi's selectors", () => {
    const abi = ['0x8d80ff0a', '0x1688f0b9', '0x8d80ff0a'].map((selector) => ({
      type: 'function' as const,
      selector,
    }))
    expect(selectorsOf({ abi }, proxyFactory141Code)).toEqual(['0x1688f0b9', '0x8d80ff0a'])
  })
})

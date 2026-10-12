import { type Hex, keccak256 } from 'viem'
import { describe, expect, it } from 'vitest'
import { authenticityReason, checkAuthenticity, type DeploymentTables } from './authenticity'

const PROXY_CODE = '0x6080aa'
const SINGLETON_141 = '0x6080bb'
const SINGLETON_120 = '0x6080cc'
const tables: DeploymentTables = {
  proxies: [{ codeHash: keccak256(PROXY_CODE), size: 3, factories: ['1.4.1 canonical'] }],
  singletons: [
    {
      contractName: 'Safe',
      version: '1.4.1',
      variant: 'canonical',
      l2: false,
      supported: true,
      codeHash: keccak256(SINGLETON_141),
    },
    {
      contractName: 'GnosisSafe',
      version: '1.2.0',
      variant: 'canonical',
      l2: false,
      supported: false,
      codeHash: keccak256(SINGLETON_120),
    },
  ],
}
const singleton = '0x41675C099F32341bf84BFc5382aF534df5C7461a'

describe('checkAuthenticity', () => {
  it('verifies a known proxy pointing at a supported singleton; the version comes from the code hash', () => {
    const a = checkAuthenticity(tables, {
      proxyCode: PROXY_CODE,
      singleton,
      singletonCode: SINGLETON_141,
      reportedVersion: '1.4.1',
    })
    expect(a).toMatchObject({
      status: 'verified',
      version: '1.4.1',
      l2: false,
      singleton,
      singletonName: 'Safe',
      codeHash: keccak256(SINGLETON_141),
      proxy: { codeHash: keccak256(PROXY_CODE) },
    })
    expect(a).not.toHaveProperty('versionMismatch')
  })

  it('flags VERSION() when it disagrees, but keeps the code-hash version', () => {
    const a = checkAuthenticity(tables, {
      proxyCode: PROXY_CODE,
      singleton,
      singletonCode: SINGLETON_141,
      reportedVersion: '9.9.9',
    })
    expect(a).toMatchObject({
      status: 'verified',
      version: '1.4.1',
      versionMismatch: '9.9.9',
      codeHash: keccak256(SINGLETON_141),
      proxy: { codeHash: keccak256(PROXY_CODE) },
    })
  })

  it('returns the computed singleton hash even when pinned hashes use uppercase hex', () => {
    const uppercaseTables: DeploymentTables = {
      proxies: tables.proxies.map((p) => ({
        ...p,
        codeHash: `0x${p.codeHash.slice(2).toUpperCase()}` as Hex,
      })),
      singletons: tables.singletons.map((s) => ({
        ...s,
        codeHash: `0x${s.codeHash.slice(2).toUpperCase()}` as Hex,
      })),
    }
    const a = checkAuthenticity(uppercaseTables, {
      proxyCode: PROXY_CODE,
      singleton,
      singletonCode: SINGLETON_141,
    })
    expect(a).toMatchObject({ status: 'verified', codeHash: keccak256(SINGLETON_141) })
  })

  it('rejects addresses with no code', () => {
    expect(
      checkAuthenticity(tables, { proxyCode: '0x', singleton, singletonCode: SINGLETON_141 })
        .status,
    ).toBe('not-a-contract')
    expect(
      checkAuthenticity(tables, { proxyCode: undefined, singleton, singletonCode: SINGLETON_141 })
        .status,
    ).toBe('not-a-contract')
  })

  it('rejects an unknown proxy even if it points at a real singleton (a contract pretending to be a Safe)', () => {
    const a = checkAuthenticity(tables, {
      proxyCode: '0x6080dd',
      singleton,
      singletonCode: SINGLETON_141,
      reportedVersion: '1.4.1',
    })
    expect(a).toEqual({ status: 'unknown-proxy', codeHash: keccak256('0x6080dd') })
  })

  it('refuses an unknown singleton, whatever VERSION() says', () => {
    const a = checkAuthenticity(tables, {
      proxyCode: PROXY_CODE,
      singleton,
      singletonCode: '0x6080ee',
      reportedVersion: '1.4.1',
    })
    expect(a).toEqual({
      status: 'unknown-singleton',
      singleton,
      codeHash: keccak256('0x6080ee'),
    })
    expect(authenticityReason(a)).toMatch(/Signing is disabled/)
  })

  it.each(['0x', undefined] as const)('refuses missing singleton code (%s)', (singletonCode) => {
    const a = checkAuthenticity(tables, {
      proxyCode: PROXY_CODE,
      singleton,
      singletonCode,
      reportedVersion: '1.4.1',
    })
    expect(a).toEqual({ status: 'unknown-singleton', singleton, codeHash: keccak256('0x') })
    expect(authenticityReason(a)).toMatch(/Signing is disabled/)
  })

  it('shows versions before 1.3.0 as unsupported', () => {
    const a = checkAuthenticity(tables, {
      proxyCode: PROXY_CODE,
      singleton,
      singletonCode: SINGLETON_120,
      reportedVersion: '1.4.1',
    })
    expect(a).toEqual({ status: 'unsupported-version', version: '1.2.0', singleton })
    expect(authenticityReason(a)).toMatch(/read-only/)
  })
})

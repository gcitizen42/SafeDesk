import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { keccak256 } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { type Authenticity, checkAuthenticity, type DeploymentTables } from '@/core/authenticity'
import { deployments } from '@/core/deployments'
import { AuthenticityBadge, AuthenticityDetails } from './authenticity-badge'

// CopyButton shares a module with browser-only address lookups; keep its real rendering.
vi.mock('@/queries/ens', () => ({ useEnsName: vi.fn() }))
vi.mock('@/queries/safes', () => ({ useLabelOf: vi.fn() }))
vi.mock('@/queries/settings', () => ({ useChain: vi.fn() }))

const proxyCode = '0x6080aa'
const singletonCode = '0x6080bb'
const singleton = '0x41675C099F32341bf84BFc5382aF534df5C7461a'
const tables: DeploymentTables = {
  proxies: [{ codeHash: keccak256(proxyCode), size: 3, factories: ['1.4.1 canonical'] }],
  singletons: [
    {
      contractName: 'Safe',
      version: '1.4.1',
      variant: 'canonical',
      l2: false,
      supported: true,
      codeHash: keccak256(singletonCode),
    },
  ],
}

const details = (authenticity: Authenticity) =>
  renderToStaticMarkup(createElement(AuthenticityDetails, { authenticity }))

describe('authenticity evidence', () => {
  it('shows both complete matching hashes and the singleton address with copy controls', () => {
    const markup = details(checkAuthenticity(tables, { proxyCode, singleton, singletonCode }))
    expect(markup).toContain(keccak256(proxyCode))
    expect(markup).toContain(keccak256(singletonCode))
    expect(markup).toContain(singleton)
    for (const label of [
      'Matching proxy runtime keccak256',
      'Matching singleton runtime keccak256',
      'Singleton address',
    ]) {
      expect(markup).toContain(`<dt class="text-xs">${label}</dt>`)
      expect(markup).toContain(`aria-label="Copy ${label}"`)
    }
  })

  it('links the pinned authoritative source and limits the claim to checked-block code identity', () => {
    const markup = details(checkAuthenticity(tables, { proxyCode, singleton, singletonCode }))
    expect(markup).toContain(
      `href="https://github.com/safe-global/safe-deployments/tree/${deployments.source.commit}"`,
    )
    expect(markup).toContain(`safe-deployments ${deployments.source.tag}`)
    expect(markup).toContain('code identity at the checked block only, based on RPC responses')
    expect(markup).toMatch(/not\s+an audit/)
    expect(markup).toContain(
      'does not establish owner safety or independently verify RPC truthfulness',
    )
  })

  it('keeps the hash evidence and warning when VERSION() disagrees', () => {
    const markup = details(
      checkAuthenticity(tables, { proxyCode, singleton, singletonCode, reportedVersion: '9.9.9' }),
    )
    expect(markup).toContain('Safe v1.4.1')
    expect(markup).toContain(keccak256(proxyCode))
    expect(markup).toContain(keccak256(singletonCode))
    expect(markup).toContain('VERSION() says &quot;9.9.9&quot;')
    expect(markup).toContain('which doesn&#x27;t match the code')
  })

  it.each<Authenticity>([
    { status: 'not-a-contract' },
    { status: 'unknown-proxy', codeHash: keccak256('0x6080dd') },
    { status: 'unknown-singleton', singleton, codeHash: keccak256('0x6080ee') },
    { status: 'unsupported-version', version: '1.2.0', singleton },
  ])('does not present matching evidence for $status', (authenticity) => {
    expect(details(authenticity)).not.toContain('authenticity-evidence')
    const badge = renderToStaticMarkup(createElement(AuthenticityBadge, { authenticity }))
    expect(badge).toContain('Not verified: read-only')
    expect(badge).not.toContain('Verified Safe')
  })
})

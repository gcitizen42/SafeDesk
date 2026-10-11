import { describe, expect, it } from 'vitest'
import { detectPathGateway, subdomainUrl } from './gateway'

const V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'

describe('path gateway check', () => {
  it('detects /ipfs/ and /ipns/ paths only', () => {
    expect(detectPathGateway(`/ipfs/${V1}/`)).toEqual({ kind: 'ipfs', id: V1 })
    expect(detectPathGateway('/ipns/plainsafe.eth/index.html')).toEqual({
      kind: 'ipns',
      id: 'plainsafe.eth',
    })
    expect(detectPathGateway('/')).toBeUndefined()
    expect(detectPathGateway('/index.html')).toBeUndefined()
    expect(detectPathGateway('/app/ipfs/x')).toBeUndefined()
  })

  it('links to the subdomain form and keeps the fragment', () => {
    const hash = '#/import/abc'
    expect(subdomainUrl({ kind: 'ipfs', id: V1 }, hash)).toBe(
      `https://${V1}.ipfs.dweb.link/#/import/abc`,
    )
    expect(subdomainUrl({ kind: 'ipfs', id: V0 }, '')).toBe(`https://dweb.link/ipfs/${V0}/`)
    expect(subdomainUrl({ kind: 'ipns', id: 'plain-safe.eth' }, '')).toBe(
      'https://plain--safe-eth.ipns.dweb.link/',
    )
  })

  it('never builds a link from an unsafe id', () => {
    const gw = detectPathGateway('/ipfs/%3Cscript%3E/')
    expect(gw).toEqual({ kind: 'ipfs', id: '' })
    expect(subdomainUrl(gw as NonNullable<typeof gw>, '')).toBeUndefined()
    expect(subdomainUrl({ kind: 'ipfs', id: 'evil.com' }, '')).toBeUndefined()
    // A malformed escape still refuses, rather than throwing before the refusal is shown
    expect(detectPathGateway('/ipfs/%zz/')).toEqual({ kind: 'ipfs', id: '' })
  })
})

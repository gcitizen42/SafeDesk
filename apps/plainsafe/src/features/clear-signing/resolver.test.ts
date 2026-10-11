import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type DescriptorCache, fetchVerified } from './resolver'

const good = JSON.stringify({ context: { contract: {} }, display: { formats: {} } })
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const COMMIT = '73787861ec2ae7699aa74587adcb074afd78be92'

vi.mock('@/generated/clear-signing/manifest.json', () => ({
  default: {
    repo: 'ethereum/clear-signing-erc7730-registry',
    commit: '73787861ec2ae7699aa74587adcb074afd78be92',
    files: Object.fromEntries(
      ['a', 'b', 'c', 'd'].map((p) => [
        `registry/x/${p}.json`,
        // Same content for every path: the manifest pins it by SHA-256
        createHash('sha256')
          .update(JSON.stringify({ context: { contract: {} }, display: { formats: {} } }))
          .digest('hex'),
      ]),
    ),
  },
}))

const served = vi.hoisted(() => ({ body: '', urls: [] as string[] }))
vi.mock('@/netguard', () => ({
  netguard: {
    fetchFor: () => async (url: string) => {
      served.urls.push(url)
      return new Response(served.body)
    },
  },
}))

function memoryCache(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const cache: DescriptorCache = {
    get: async (k) => data.get(k),
    put: async (k, _path, text) => {
      data.set(k, text)
    },
  }
  return { cache, data }
}

describe('hash-verified registry downloads (SPEC §7.2)', () => {
  beforeEach(() => {
    served.urls = []
  })

  it('fetches the pinned commit and caches a file whose SHA-256 matches', async () => {
    served.body = good
    const { cache, data } = memoryCache()
    await expect(fetchVerified('registry/x/a.json', cache)).resolves.toEqual(JSON.parse(good))
    expect(served.urls).toEqual([
      `https://raw.githubusercontent.com/ethereum/clear-signing-erc7730-registry/${COMMIT}/registry/x/a.json`,
    ])
    expect(data.get(sha(good))).toBe(good)
  })

  it('drops a file whose SHA-256 differs, and caches nothing', async () => {
    served.body = good.replace('formats', 'formatz')
    const { cache, data } = memoryCache()
    await expect(fetchVerified('registry/x/b.json', cache)).rejects.toThrow(/SHA-256/)
    expect(data.size).toBe(0)
  })

  it('uses a cached copy without a request, but refetches when the cache was tampered with', async () => {
    served.body = good
    const clean = memoryCache({ [sha(good)]: good })
    await expect(fetchVerified('registry/x/c.json', clean.cache)).resolves.toEqual(JSON.parse(good))
    expect(served.urls).toEqual([])

    const tampered = memoryCache({ [sha(good)]: '{"evil":true}' })
    await expect(fetchVerified('registry/x/d.json', tampered.cache)).resolves.toEqual(
      JSON.parse(good),
    )
    expect(served.urls).toHaveLength(1)
  })

  it('refuses paths the manifest does not list', async () => {
    await expect(fetchVerified('registry/x/unlisted.json')).rejects.toThrow(/manifest/)
    expect(served.urls).toEqual([])
  })
})

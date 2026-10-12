export interface PublicChain {
  chainId: number
  name: string
  rpcs: string[]
  nativeCurrency: { name: string; symbol: string; decimals: number }
  explorers: { name: string; url: string }[]
  testnet: boolean
  rotationSupported: boolean
}

export interface PublicChainCatalog {
  source: 'chainlist.org' | 'built-in'
  fetchedAt: string
  chains: PublicChain[]
}

const unavailable = 'Public chain catalogue is unavailable. Try again.'
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit

function isPublicUrl(value: unknown): value is string {
  if (!isText(value, 2048)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

function isChain(value: unknown): value is PublicChain {
  if (!isObject(value) || !isObject(value.nativeCurrency)) return false
  const currency = value.nativeCurrency
  return (
    typeof value.chainId === 'number' &&
    Number.isSafeInteger(value.chainId) &&
    value.chainId > 0 &&
    isText(value.name, 120) &&
    Array.isArray(value.rpcs) &&
    value.rpcs.length <= 30 &&
    value.rpcs.every(isPublicUrl) &&
    isText(currency.name, 120) &&
    isText(currency.symbol, 32) &&
    typeof currency.decimals === 'number' &&
    Number.isInteger(currency.decimals) &&
    currency.decimals >= 0 &&
    currency.decimals <= 255 &&
    Array.isArray(value.explorers) &&
    value.explorers.length <= 5 &&
    value.explorers.every(
      (explorer: unknown) =>
        isObject(explorer) && isText(explorer.name, 120) && isPublicUrl(explorer.url),
    ) &&
    typeof value.testnet === 'boolean' &&
    typeof value.rotationSupported === 'boolean'
  )
}

export async function fetchPublicChains(signal?: AbortSignal): Promise<PublicChainCatalog> {
  try {
    const timeout = AbortSignal.timeout(15000)
    const response = await fetch('/api/chains', {
      redirect: 'error',
      mode: 'same-origin',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) throw new Error(unavailable)
    const data: unknown = await response.json()
    if (
      !isObject(data) ||
      (data.source !== 'chainlist.org' && data.source !== 'built-in') ||
      !isText(data.fetchedAt, 32) ||
      !Number.isFinite(Date.parse(data.fetchedAt)) ||
      !Array.isArray(data.chains) ||
      data.chains.length === 0 ||
      !data.chains.every(isChain) ||
      new Set(data.chains.map((chain) => chain.chainId)).size !== data.chains.length
    ) {
      throw new Error(unavailable)
    }
    return { source: data.source, fetchedAt: data.fetchedAt, chains: data.chains }
  } catch {
    throw new Error(unavailable)
  }
}

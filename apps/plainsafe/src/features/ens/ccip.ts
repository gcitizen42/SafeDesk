// CCIP-read (EIP-3668) through netguard (SPEC §8.2). Gateway hosts come from each resolver's
// OffchainLookup revert, so they can't be listed ahead of time: when the capability is on,
// netguard allows any https host for this function's requests only. When it's off, this fails
// immediately and nothing is requested.
import { type Address, type Hex, isHex } from 'viem'
import { netguard } from '@/netguard'

class CcipReadDisabled extends Error {
  constructor() {
    super('off-chain name (CCIP-read disabled)')
    this.name = 'CcipReadDisabled'
  }
}

export async function ccipRequest({
  data,
  sender,
  urls,
}: {
  data: Hex
  sender: Address
  urls: readonly string[]
}): Promise<Hex> {
  if (!netguard.getPolicy().ccipRead) throw new CcipReadDisabled()
  let error: Error = new Error('No gateway answered')
  for (const url of urls) {
    const method = url.includes('{data}') ? 'GET' : 'POST'
    try {
      const response = await netguard.ccipFetch(
        url.replace('{sender}', sender.toLowerCase()).replace('{data}', data),
        {
          method,
          ...(method === 'POST'
            ? {
                body: JSON.stringify({ data, sender }),
                headers: { 'Content-Type': 'application/json' },
              }
            : {}),
        },
      )
      if (!response.ok) {
        error = new Error(`Gateway ${new URL(url).host} answered HTTP ${response.status}`)
        continue
      }
      const result: unknown = response.headers.get('Content-Type')?.startsWith('application/json')
        ? ((await response.json()) as { data?: unknown }).data
        : await response.text()
      if (typeof result !== 'string' || !isHex(result)) {
        error = new Error(`Gateway ${new URL(url).host} returned a malformed response`)
        continue
      }
      return result
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw error
}

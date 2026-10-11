// Parsing Uniswap-format token lists with partial acceptance (SPEC §10), and exporting My tokens.
import { Either, Schema } from 'effect'
import { getAddress } from 'viem'
import { normalize } from 'viem/ens'
import { ListToken, TokenListEnvelope } from '@/schemas/tokenlist'

interface ParsedList {
  readonly name: string
  readonly tokens: readonly ListToken[]
  /** Malformed tokens skipped one at a time, rather than rejecting the whole list. */
  readonly skipped: number
}

export function parseTokenList(json: unknown): Either.Either<ParsedList, string> {
  const envelope = Schema.decodeUnknownEither(TokenListEnvelope)(json)
  if (Either.isLeft(envelope))
    return Either.left('Not a token list (it needs a name and a tokens array).')
  const seen = new Set<string>()
  const tokens: ListToken[] = []
  let skipped = 0
  for (const raw of envelope.right.tokens) {
    const t = Schema.decodeUnknownEither(ListToken)(raw)
    if (Either.isLeft(t)) {
      skipped++
      continue
    }
    const key = `${t.right.chainId}:${t.right.address.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push({ ...t.right, address: getAddress(t.right.address) })
  }
  return Either.right({ name: envelope.right.name, tokens, skipped })
}

/** My tokens as a Uniswap-format list (SPEC §10). */
export function exportTokenList(name: string, tokens: readonly ListToken[], now = new Date()) {
  return {
    name,
    timestamp: now.toISOString(),
    version: { major: 1, minor: 0, patch: 0 },
    tokens: tokens.map(({ chainId, address, symbol, name: n, decimals }) => ({
      chainId,
      address,
      symbol,
      name: n || symbol,
      decimals,
    })),
  }
}

/** Addresses of tokens whose symbol is shared by another token on the same chain (SPEC §10). */
export function duplicateSymbols(
  tokens: readonly { chainId: number; address: string; symbol: string }[],
): Set<string> {
  const bySymbol = new Map<string, Set<string>>()
  for (const t of tokens) {
    const k = `${t.chainId}:${t.symbol.toUpperCase()}`
    const set = bySymbol.get(k) ?? new Set()
    set.add(t.address.toLowerCase())
    bySymbol.set(k, set)
  }
  const out = new Set<string>()
  for (const set of bySymbol.values()) if (set.size > 1) for (const a of set) out.add(a)
  return out
}

export interface ListSource {
  /** What gets fetched. */
  readonly url: string
  /** The ENS name, when the list was given as one. */
  readonly ensName?: string
}

/**
 * Where to fetch a token list from (SPEC §8.2): an https:// URL as given, or a .eth name through
 * eth.limo, which serves the name's contenthash (tokenlist.aave.eth → https://tokenlist.aave.eth.limo/).
 */
export function tokenListSource(input: string): Either.Either<ListSource, string> {
  const t = input.trim()
  if (t.startsWith('https://')) {
    try {
      new URL(t)
      return Either.right({ url: t })
    } catch {
      return Either.left('Not a valid URL.')
    }
  }
  if (/^[^/:\s]+\.eth$/i.test(t)) {
    let name: string
    try {
      name = normalize(t)
    } catch {
      return Either.left(`${t} is not a valid ENS name.`)
    }
    return Either.right({ url: `https://${name}.limo/`, ensName: name })
  }
  return Either.left('Enter an https:// URL or an ENS name ending in .eth.')
}

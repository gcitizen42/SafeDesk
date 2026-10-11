// Token lists and My tokens in IndexedDB (SPEC §9.5, §10). Lists are global: they apply to every
// Safe on a matching chainId, and each can be turned on or off.
import { Effect, Option } from 'effect'
import type { Address } from 'viem'
import defaults from '@/generated/default-tokenlist.json'
import { type ListToken, MyToken, myTokenKey, TokenListRecord } from '@/schemas/tokenlist'
import { Storage } from '@/storage/service'

export const BUILT_IN_ID = 'built-in'
const builtInTokens = defaults.tokens as unknown as ListToken[]

export interface TokenInfo extends ListToken {
  /** Where the symbol came from: a list's name, "My tokens", or the token contract. */
  readonly source: string
}

export const listTokenLists = Effect.gen(function* () {
  const storage = yield* Storage
  const { records, invalid } = yield* storage.getAll('tokenlists', TokenListRecord)
  const lists = records.map((r) => r.value)
  const builtIn = lists.find((l) => l.id === BUILT_IN_ID)
  const all = [
    {
      id: BUILT_IN_ID,
      name: defaults.name,
      source: 'built-in',
      enabled: builtIn?.enabled ?? true,
      tokens: builtInTokens,
      importedAt: '',
    },
    ...lists.filter((l) => l.id !== BUILT_IN_ID),
  ]
  return { lists: all, invalid }
})

export const saveTokenList = (record: TokenListRecord) =>
  Effect.flatMap(Storage, (s) =>
    s.put(
      'tokenlists',
      record.id,
      TokenListRecord,
      record.id === BUILT_IN_ID ? { ...record, tokens: [] } : record,
    ),
  )

export const setListEnabled = (id: string, enabled: boolean) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const current = yield* storage.get('tokenlists', id, TokenListRecord)
    const base = Option.getOrUndefined(current) ?? {
      id,
      name: defaults.name,
      source: 'built-in',
      enabled,
      tokens: [],
      importedAt: '',
    }
    yield* storage.put('tokenlists', id, TokenListRecord, { ...base, enabled })
  })

export const deleteTokenList = (id: string) =>
  Effect.flatMap(Storage, (s) => s.remove('tokenlists', id))

export const listMyTokens = Effect.flatMap(Storage, (s) => s.getAll('mytokens', MyToken)).pipe(
  Effect.map(({ records, invalid }) => ({ tokens: records.map((r) => r.value), invalid })),
)

export const addMyToken = (t: MyToken) =>
  Effect.flatMap(Storage, (s) => s.put('mytokens', myTokenKey(t.chainId, t.address), MyToken, t))

export const removeMyToken = (chainId: number, address: Address) =>
  Effect.flatMap(Storage, (s) => s.remove('mytokens', myTokenKey(chainId, address)))

/** Every known token on a chain: My tokens first, then enabled lists; identified by address. */
export function tokenUniverse(
  chainId: number,
  lists: readonly TokenListRecord[],
  mine: readonly MyToken[],
): TokenInfo[] {
  const out = new Map<string, TokenInfo>()
  for (const t of mine)
    if (t.chainId === chainId) out.set(t.address.toLowerCase(), { ...t, source: 'My tokens' })
  for (const l of lists) {
    if (!l.enabled) continue
    for (const t of l.tokens) {
      if (t.chainId === chainId && !out.has(t.address.toLowerCase()))
        out.set(t.address.toLowerCase(), { ...t, source: l.name })
    }
  }
  return [...out.values()]
}

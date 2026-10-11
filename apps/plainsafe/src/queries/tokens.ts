import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type Address, keccak256, toHex } from 'viem'
import { run } from '@/effect/run'
import { ethFiatRate, loadBalances } from '@/features/balances/program'
import {
  addMyToken,
  deleteTokenList,
  listMyTokens,
  listTokenLists,
  removeMyToken,
  saveTokenList,
  setListEnabled,
  tokenUniverse,
} from '@/features/tokens/store'
import { tokenMeta } from '@/features/tokens/token-meta'
import type { TokenListRecord } from '@/schemas/tokenlist'
import { keys } from './keys'
import { FRESH_MS, STALE_MS } from './safes'
import { useLoadedSettings } from './settings'

export function useTokenLists() {
  return useQuery({
    queryKey: keys.tokenLists(),
    queryFn: () => run(listTokenLists),
    staleTime: Number.POSITIVE_INFINITY,
  })
}
export function useMyTokens() {
  return useQuery({
    queryKey: keys.myTokens(),
    queryFn: () => run(listMyTokens),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Known tokens on a chain, from My tokens and enabled lists. */
export function useTokenUniverse(chainId: number) {
  const lists = useTokenLists()
  const mine = useMyTokens()
  return useMemo(
    () =>
      lists.data && mine.data
        ? tokenUniverse(chainId, lists.data.lists, mine.data.tokens)
        : undefined,
    [chainId, lists.data, mine.data],
  )
}

/** A cache-key fingerprint of a token set: its addresses, in any order and case. */
export const useTokenSetHash = (tokens: readonly { readonly address: string }[] | undefined) =>
  useMemo(
    () =>
      tokens
        ? keccak256(
            toHex([...new Set(tokens.map((t) => t.address.toLowerCase()))].sort().join(',')),
          )
        : '0x',
    [tokens],
  )

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: keys.tokenLists() })
    void queryClient.invalidateQueries({ queryKey: keys.myTokens() })
    void queryClient.invalidateQueries({ queryKey: keys.allBalances() })
  }
}

export function useTokenMutations() {
  const invalidate = useInvalidate()
  const opts = { onSuccess: invalidate }
  return {
    saveList: useMutation({ mutationFn: (r: TokenListRecord) => run(saveTokenList(r)), ...opts }),
    setEnabled: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
        run(setListEnabled(id, enabled)),
      ...opts,
    }),
    deleteList: useMutation({ mutationFn: (id: string) => run(deleteTokenList(id)), ...opts }),
    /** Symbol and decimals are read from the token contract (SPEC §10). */
    addMine: useMutation({
      mutationFn: async ({ chainId, address }: { chainId: number; address: Address }) => {
        const meta = await run(tokenMeta(chainId, address))
        await run(
          addMyToken({
            chainId,
            address: meta.address,
            symbol: meta.symbol,
            name: meta.name ?? '',
            decimals: meta.decimals,
            addedAt: new Date().toISOString(),
          }),
        )
      },
      ...opts,
    }),
    removeMine: useMutation({
      mutationFn: ({ chainId, address }: { chainId: number; address: Address }) =>
        run(removeMyToken(chainId, address)),
      ...opts,
    }),
  }
}

/** `fresh` re-reads on mount unless the last read is under 5 s old, instead of under 30 s. */
export function useBalances(chainId: number, safe: Address, { fresh = false } = {}) {
  const tokens = useTokenUniverse(chainId)
  const tokenSetHash = useTokenSetHash(tokens)
  return useQuery({
    queryKey: keys.balances(chainId, safe, tokenSetHash),
    queryFn: () => run(loadBalances(chainId, safe, tokens ?? [])),
    enabled: !!tokens,
    staleTime: fresh ? FRESH_MS : STALE_MS,
  })
}

/** Fiat per ETH, when the currency is fiat and Mainnet is set up (SPEC §10.1). */
export function useEthFiat() {
  const settings = useLoadedSettings()
  const currency = settings.currency
  const hasMainnet = settings.chains.some((c) => c.id === 1)
  return useQuery({
    queryKey: keys.ethFiat(currency),
    queryFn: () => run(ethFiatRate(currency as 'USD' | 'EUR')),
    enabled: currency !== 'ETH' && hasMainnet,
    staleTime: 60_000,
  })
}

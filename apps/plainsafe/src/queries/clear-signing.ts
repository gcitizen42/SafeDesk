import type { ExternalDataProvider, TrustedTokens } from '@ethereum-sourcify/clear-signing'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Either } from 'effect'
import { useMemo } from 'react'
import type { Address, Hex } from 'viem'
import type { SafeTx } from '@/core/safe-tx'
import { run } from '@/effect/run'
import { parseUserDescriptor } from '@/features/clear-signing/parse-descriptor'
import { renderClearSigning } from '@/features/clear-signing/render'
import type { SafeContext } from '@/features/clear-signing/resolver'
import { loadBundle } from '@/features/clear-signing/resolver'
import {
  descriptorCache,
  listUserDescriptors,
  removeUserDescriptor,
  saveUserDescriptor,
  toUserDescriptor,
} from '@/features/clear-signing/store'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { tokenMeta } from '@/features/tokens/token-meta'
import { labelFor } from '@/schemas/safes'
import { keys } from './keys'
import { useAddressBook } from './safes'
import { useLoadedSettings } from './settings'
import { useTokenSetHash, useTokenUniverse } from './tokens'

/** The pinned registry commit this build bundles (Settings → Clear signing, and About). */
export function useBundledRegistry() {
  return useQuery({
    queryKey: keys.bundledRegistry(),
    queryFn: async () => {
      const b = await loadBundle()
      return { repo: b.repo, commit: b.commit, files: Object.keys(b.files).length }
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useUserDescriptors() {
  return useQuery({
    queryKey: keys.userDescriptors(),
    queryFn: () => run(listUserDescriptors),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Import an ERC-7730 file (checked before it's stored), or remove an imported one. */
export function useDescriptorMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.userDescriptors() })
  return {
    add: useMutation({
      mutationFn: async (file: File) => {
        const parsed = await parseUserDescriptor(await file.text(), file.name)
        if (Either.isLeft(parsed)) throw new Error(parsed.left)
        await run(saveUserDescriptor(parsed.right))
      },
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => run(removeUserDescriptor(id)),
      onSuccess: invalidate,
    }),
  }
}

/**
 * The clear-signing rendering of a Safe transaction (SPEC §7.2), for code-hash-verified Safes
 * only: the descriptor is chosen by the version the code hash proves.
 */
export function useClearSigning(
  chainId: number,
  safe: SafeSnapshot | undefined,
  tx: SafeTx,
  safeTxHash: Hex,
) {
  const a = safe?.authenticity
  const ctx =
    safe && a?.status === 'verified'
      ? { chainId, safe: safe.address, version: a.version, l2: a.l2 }
      : undefined
  return useClearSigningFor(ctx, tx, safeTxHash, false)
}

/**
 * The same rendering for a given context. `offline` (the Verify page, SPEC §3.10) uses only
 * bundled and imported descriptors and local token data: no RPC and no registry downloads.
 */
export function useClearSigningFor(
  ctx: SafeContext | undefined,
  tx: SafeTx,
  safeTxHash: Hex,
  offline: boolean,
) {
  const chainId = ctx?.chainId ?? 0
  const settings = useLoadedSettings()
  const remote = !offline && settings.capabilities.clearSigningDescriptors
  const tokens = useTokenUniverse(chainId)
  const book = useAddressBook()
  const user = useUserDescriptors()

  const trustedTokens = useMemo((): TrustedTokens | undefined => {
    if (!tokens) return undefined
    return {
      [chainId]: Object.fromEntries(tokens.map((t) => [t.address.toLowerCase(), 'erc20' as const])),
    }
  }, [chainId, tokens])

  const provider = useMemo((): ExternalDataProvider | undefined => {
    if (!tokens || !book.data) return undefined
    const entries = book.data.entries
    return {
      // Token lists and My tokens first; otherwise read it over RPC and say so (SPEC §7.2).
      resolveToken: async (id, address) => {
        if (id !== chainId) return null
        const known = tokens.find((t) => t.address.toLowerCase() === address.toLowerCase())
        if (known) return { name: known.name, symbol: known.symbol, decimals: known.decimals }
        if (offline) return null
        try {
          const m = await run(tokenMeta(chainId, address as Address))
          return {
            name: m.name ?? m.symbol,
            symbol: `${m.symbol} (not in your lists)`,
            decimals: m.decimals,
          }
        } catch {
          return null
        }
      },
      resolveLocalName: async (address) => {
        const label = labelFor(entries, chainId, address)
        return label ? { name: label, typeMatch: true } : null
      },
      resolveChainInfo: async (id) => {
        const c = settings.chains.find((x) => x.id === id)
        return c ? { name: c.name, nativeCurrency: { ...c.nativeCurrency } } : null
      },
    }
  }, [tokens, book.data, chainId, settings.chains, offline])

  const tokenSet = useTokenSetHash(tokens)
  return useQuery({
    queryKey: [
      ...keys.render(chainId, safeTxHash),
      ctx?.safe,
      ctx?.version,
      ctx?.l2,
      remote,
      offline,
      tokenSet,
      book.dataUpdatedAt,
      user.dataUpdatedAt,
    ],
    queryFn: () =>
      renderClearSigning(ctx as SafeContext, tx, {
        remote,
        userDescriptors: (user.data?.descriptors ?? []).map(toUserDescriptor),
        externalDataProvider: provider as ExternalDataProvider,
        trustedTokens: trustedTokens as TrustedTokens,
        cache: offline ? undefined : descriptorCache,
      }).then((r) => r ?? null),
    enabled: !!ctx && !!provider && !!trustedTokens && user.isFetched,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

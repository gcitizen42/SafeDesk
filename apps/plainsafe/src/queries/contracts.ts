import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { run } from '@/effect/run'
import { type ContractInspection, inspectContract } from '@/features/abi/inspect'
import { getSavedAbi, listSavedAbis, removeSavedAbi, saveAbi } from '@/features/abi/library'
import { fetchSourcifyAbi, lookupSignatures } from '@/features/abi/remote'
import { tokenMeta } from '@/features/tokens/token-meta'
import type { AbiRecord } from '@/schemas/abi'
import { keys } from './keys'
import { useLoadedSettings } from './settings'

export const inspectQuery = (chainId: number, address: Address) => ({
  queryKey: keys.whatsabi(chainId, address),
  queryFn: () => run(inspectContract(chainId, address)),
  staleTime: 60_000,
})

export function useInspect(chainId: number, address: Address | undefined) {
  return useQuery({ ...inspectQuery(chainId, address ?? '0x'), enabled: !!address })
}

export function useTokenMeta(chainId: number, token: Address | undefined) {
  return useQuery({
    queryKey: keys.tokenMeta(chainId, token ?? '0x'),
    queryFn: () => run(tokenMeta(chainId, token as Address)),
    enabled: !!token,
    staleTime: 5 * 60_000,
  })
}

export function useSavedAbi(chainId: number, codeHash: Hex | undefined) {
  return useQuery({
    queryKey: keys.savedAbi(chainId, codeHash ?? '0x'),
    queryFn: async () => (await run(getSavedAbi(chainId, codeHash as Hex))) ?? null,
    enabled: !!codeHash,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSaveAbi() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (record: AbiRecord) => run(saveAbi(record)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.savedAbis() }),
  })
}

export function useSavedAbis() {
  return useQuery({
    queryKey: keys.savedAbis(),
    queryFn: () => run(listSavedAbis),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useRemoveAbi() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chainId, codeHash }: { chainId: number; codeHash: string }) =>
      run(removeSavedAbi(chainId, codeHash)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.savedAbis() }),
  })
}

/** The implementation's verified ABI from Sourcify, only with the capability on (SPEC §7.3). */
export function useSourcifyAbi(chainId: number, inspection: ContractInspection | undefined) {
  const on = useLoadedSettings().capabilities.sourcify
  const hash = inspection?.implementationCodeHash
  return useQuery({
    queryKey: keys.sourcify(chainId, hash ?? '0x'),
    queryFn: () => fetchSourcifyAbi(chainId, inspection?.implementation as Address),
    enabled: on && !!inspection?.hasCode && !inspection.delegatedTo && !!hash,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Signature-database entries for a selector, only with the capability on (SPEC §7.1 level 4). */
export function useSignatureLookup(selector: Hex | undefined) {
  const on = useLoadedSettings().capabilities.signatureDatabase
  return useQuery({
    queryKey: keys.signatures(selector ?? '0x'),
    queryFn: () => lookupSignatures(selector as Hex),
    enabled: on && !!selector,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

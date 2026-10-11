import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import type { CreationPlan } from '@/core/create-safe'
import { run } from '@/effect/run'
import { checkCreation } from '@/features/safes/create-program'
import { loadSafe } from '@/features/safes/load-safe'
import {
  listAddressBook,
  listSafes,
  removeLabel,
  removeSafe,
  saveSafe,
  setLabel,
} from '@/features/safes/store'
import { type AddressBookEntry, labelFor, type SafeRecord } from '@/schemas/safes'
import { keys } from './keys'

/** How old a chain-state read may be before a view re-reads it; "fresh" is for safety decisions. */
export const STALE_MS = 30_000
export const FRESH_MS = 5_000

/**
 * Chain state: owners, threshold, nonce and authenticity at a fresh pinned block. `fresh`
 * re-reads on entry unless the last read is under 5 s old (a Safe just loaded by the previous
 * screen is current enough), for screens that make safety decisions (SPEC §8.4).
 */
export function useSafe(chainId: number, address: Address | undefined, { fresh = false } = {}) {
  return useQuery({
    queryKey: keys.safe(chainId, address ?? '0x'),
    queryFn: () => run(loadSafe(chainId, address as Address)),
    enabled: !!address,
    staleTime: fresh ? FRESH_MS : STALE_MS,
  })
}

type SafeStore = 'safes' | 'recent'
const safeListKey = (store: SafeStore) => (store === 'safes' ? keys.mySafes() : keys.recent())

export function useSafeList(store: SafeStore) {
  return useQuery({
    queryKey: safeListKey(store),
    queryFn: () => run(listSafes(store)),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSaveSafe(store: SafeStore) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (record: SafeRecord) => run(saveSafe(store, record)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: safeListKey(store) }),
  })
}

export function useRemoveSafe(store: SafeStore) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chainId, address }: { chainId: number; address: string }) =>
      run(removeSafe(store, chainId, address)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: safeListKey(store) }),
  })
}

export function useAddressBook() {
  return useQuery({
    queryKey: keys.addressBook(),
    queryFn: () => run(listAddressBook),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Looks up address book labels, the only source of labels (SPEC §6). */
export function useLabelOf() {
  const entries = useAddressBook().data?.entries
  return (chainId: number, address: string) =>
    entries ? labelFor(entries, chainId, address) : undefined
}

export function useSetLabels() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (entries: readonly AddressBookEntry[]) => {
      for (const e of entries) await run(setLabel(e))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.addressBook() }),
  })
}

export function useRemoveLabel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chainId, address }: { chainId: number | '*'; address: string }) =>
      run(removeLabel(chainId, address)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.addressBook() }),
  })
}

/**
 * SPEC §3.14: the checks before creating a Safe (official contracts by code hash, the predicted
 * address, and the factory's own answer). Re-run on each review, since chain state can change.
 */
export function useCreationCheck(plan: CreationPlan | undefined, from: Address | undefined) {
  return useQuery({
    queryKey: plan
      ? keys.safeCreation(plan.chainId, plan.address, from)
      : ['safe-creation', 'none'],
    queryFn: () => run(checkCreation(plan as CreationPlan, from)),
    enabled: !!plan,
    staleTime: 0,
    retry: false,
  })
}

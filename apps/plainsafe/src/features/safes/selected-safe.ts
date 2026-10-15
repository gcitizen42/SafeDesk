import { Either, Schema } from 'effect'
import { useSyncExternalStore } from 'react'
import { type Address, getAddress } from 'viem'
import { Address as AddressSchema, ChainId } from '@/schemas/common'
import { type AddressBookEntry, labelFor, type SafeRecord, safeKey } from '@/schemas/safes'
import type { SafeSnapshot } from './load-safe'
import { safeRecord } from './store'

const SafeSelection = Schema.Struct({
  chainId: ChainId,
  address: AddressSchema,
  label: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
})
export interface SelectedSafe {
  readonly chainId: number
  readonly address: string
  readonly label?: string
}
export interface SafeContext {
  readonly selectedSafe?: SelectedSafe
  readonly safes: readonly SelectedSafe[]
}

/** Only public identity and a display label cross the dashboard boundary. */
export function normalizeSelectedSafe(input: unknown): SelectedSafe | undefined {
  const decoded = Schema.decodeUnknownEither(SafeSelection)(input)
  if (Either.isLeft(decoded)) return undefined
  const value = decoded.right
  const label = value.label?.trim()
  return { chainId: value.chainId, address: getAddress(value.address), ...(label ? { label } : {}) }
}

export const selectedSafeKey = (safe: SelectedSafe | undefined) =>
  safe ? safeKey(safe.chainId, safe.address) : ''

export function selectedSafeFromRoute(
  location: string,
  chains: readonly number[],
): SelectedSafe | undefined {
  const match = /^\/safe\/([1-9]\d*)\/(0x[0-9a-fA-F]{40})(?:\/[^?#]*)?(?:[?#].*)?$/.exec(location)
  if (!match) return undefined
  const chainId = Number(match[1])
  return chains.includes(chainId)
    ? normalizeSelectedSafe({ chainId, address: match[2] })
    : undefined
}

export function safeChoiceLabel(safe: SelectedSafe, chainName = `Chain ${safe.chainId}`) {
  const address = `${safe.address.slice(0, 8)}...${safe.address.slice(-6)}`
  return `${safe.label ? `${safe.label} / ` : ''}${address} / ${chainName}`
}

/** My Safes wins a duplicate; the same address on another chain is a separate choice. */
export function mergeSafeChoices(
  mySafes: readonly Pick<SafeRecord, 'chainId' | 'address'>[],
  recent: readonly Pick<SafeRecord, 'chainId' | 'address'>[],
  entries: readonly AddressBookEntry[] = [],
  temporary: readonly SelectedSafe[] = [],
): SelectedSafe[] {
  const rows = new Map<string, SelectedSafe>()
  for (const row of [...mySafes, ...recent, ...temporary]) {
    const value = normalizeSelectedSafe(row)
    if (!value || rows.has(selectedSafeKey(value))) continue
    const label = labelFor(entries, value.chainId, value.address) ?? value.label
    rows.set(selectedSafeKey(value), { ...value, ...(label ? { label } : {}) })
  }
  return [...rows.values()]
}

/** In-memory selection survives workspace-tab navigation. Late hydration never overrides a choice. */
export function createSelectedSafeStore() {
  let selected: SelectedSafe | undefined
  let revision = 0
  const listeners = new Set<() => void>()
  const select = (input: unknown) => {
    const next = normalizeSelectedSafe(input)
    if (!next) return
    if (selectedSafeKey(next) === selectedSafeKey(selected) && next.label === selected?.label)
      return
    selected = next
    revision++
    for (const notify of listeners) notify()
  }
  return {
    getSnapshot: () => selected,
    select,
    subscribe: (notify: () => void) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    restore: async (load: () => Promise<unknown>) => {
      const before = revision
      const value = await load()
      if (revision === before && !selected) select(value)
    },
  }
}

export const selectedSafeStore = createSelectedSafeStore()
export function useSelectedSafe() {
  const selectedSafe = useSyncExternalStore(
    selectedSafeStore.subscribe,
    selectedSafeStore.getSnapshot,
    selectedSafeStore.getSnapshot,
  )
  return { selectedSafe, selectSafe: selectedSafeStore.select }
}

/** Backend owner lists are not authenticity evidence. A fresh frontend code check is required. */
export async function verifiedSafeRecord(
  target: SelectedSafe,
  read?: (chainId: number, address: Address) => Promise<SafeSnapshot>,
): Promise<SafeRecord | undefined> {
  const choice = normalizeSelectedSafe(target)
  if (!choice) return undefined
  const snapshot = read
    ? await read(choice.chainId, choice.address as Address)
    : await Promise.all([import('@/effect/run'), import('./load-safe')]).then(
        ([{ run }, { loadSafe }]) => run(loadSafe(choice.chainId, choice.address as Address)),
      )
  if (
    snapshot.chainId !== choice.chainId ||
    snapshot.address.toLowerCase() !== choice.address.toLowerCase() ||
    snapshot.authenticity?.status !== 'verified'
  )
    return undefined
  return safeRecord(snapshot)
}

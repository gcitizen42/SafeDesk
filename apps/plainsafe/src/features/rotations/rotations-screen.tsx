import { createIcons, icons } from 'lucide'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  mergeSafeChoices,
  normalizeSelectedSafe,
  type SafeContext,
  type SelectedSafe,
  safeChoiceLabel,
  selectedSafeKey,
  useSelectedSafe,
  verifiedSafeRecord,
} from '@/features/safes/selected-safe'
import { useAddressBook, useSafeList, useSaveSafe } from '@/queries/safes'
import type { SafeRecord } from '@/schemas/safes'
import css from '../../../../../scripts/safe-batch/dashboard.css?raw'
import markup from '../../../../../scripts/safe-batch/dashboard.html?raw'
import { mountRotations } from '../../../../../scripts/safe-batch/dashboard.mjs'

interface RotationOptions {
  getSafeContext(): SafeContext
  onSafeSelected(safe: SelectedSafe): void
  onSafeAdded(safe: SelectedSafe): void
  onBusy(busy: boolean): void
}

/** Inspection adds a choice, never changes the selected Safe or resets the wizard. */
export function createSafeAdditionHandler(callbacks: {
  onChoice(safe: SelectedSafe): void
  onStatus(safe: SelectedSafe, text: string | undefined): void
  verify(safe: SelectedSafe): Promise<SafeRecord | undefined>
  existing(safe: SelectedSafe): SafeRecord | undefined
  save(record: SafeRecord): Promise<unknown>
}) {
  let active = true
  let latest: symbol | undefined
  const requests = new Map<string, symbol>()
  return {
    async add(input: SelectedSafe) {
      const safe = normalizeSelectedSafe(input)
      if (!active || !safe) return
      const key = selectedSafeKey(safe)
      const token = Symbol(key)
      latest = token
      requests.set(key, token)
      callbacks.onChoice(safe)
      callbacks.onStatus(safe, 'Checking contract authenticity before adding to My Safes...')
      const current = () => active && requests.get(key) === token
      const status = (text: string | undefined) => {
        if (current() && latest === token) callbacks.onStatus(safe, text)
      }
      try {
        const record = await callbacks.verify(safe)
        if (!current()) return
        if (!record) {
          status(
            'Contract authenticity unverified. This Safe remains an Ownership Manager choice but was not added to My Safes.',
          )
          return
        }
        const existing = callbacks.existing(safe)
        await callbacks.save({ ...record, ...(existing ? { addedAt: existing.addedAt } : {}) })
        status(undefined)
      } catch {
        status(
          'Could not verify or save this Safe. It remains an Ownership Manager choice; no unverified contract was added to My Safes.',
        )
      }
    },
    dispose() {
      active = false
      requests.clear()
    },
  }
}

/** Lists/labels stay live; a different chain/address remounts only when the dashboard is idle. */
export function createRotationsBridge(
  mount: (options: RotationOptions) => () => void,
  callbacks: Pick<RotationOptions, 'onSafeSelected' | 'onSafeAdded' | 'onBusy'>,
) {
  let desired: SafeContext = { safes: [] }
  let mounted: SelectedSafe | undefined
  let dispose: (() => void) | undefined
  let busy = false
  let generation = 0
  let mounting = false
  let stopped = false
  const reconcile = () => {
    if (
      stopped ||
      mounting ||
      busy ||
      (dispose && selectedSafeKey(desired.selectedSafe) === selectedSafeKey(mounted))
    )
      return
    const current = ++generation
    dispose?.()
    let selection = desired.selectedSafe
    mounted = selection
    mounting = true
    dispose = mount({
      getSafeContext: () => ({
        safes: desired.safes,
        ...(selection
          ? {
              selectedSafe:
                selectedSafeKey(selection) === selectedSafeKey(desired.selectedSafe)
                  ? desired.selectedSafe
                  : selection,
            }
          : {}),
      }),
      onSafeSelected: (input) => {
        const safe = normalizeSelectedSafe(input)
        if (!stopped && current === generation && !busy && safe) {
          // The dashboard already switched scope and reset its wizard itself.
          mounted = safe
          selection = safe
          callbacks.onSafeSelected(safe)
        }
      },
      onSafeAdded: (input) => {
        const safe = normalizeSelectedSafe(input)
        if (!stopped && current === generation && safe) callbacks.onSafeAdded(safe)
      },
      onBusy: (value) => {
        if (stopped || current !== generation) return
        busy = value
        callbacks.onBusy(value)
        if (!value) queueMicrotask(reconcile)
      },
    })
    mounting = false
    reconcile()
  }
  return {
    update(context: SafeContext) {
      desired = context
      reconcile()
    },
    dispose() {
      stopped = true
      generation++
      dispose?.()
      callbacks.onBusy(false)
    },
  }
}

export function SafeAdditionStatus({ safe, text }: { safe: SelectedSafe; text: string }) {
  return (
    <p role="status" className="px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      {safeChoiceLabel(safe)}: {text}
    </p>
  )
}

export function RotationsScreen() {
  const host = useRef<HTMLDivElement>(null)
  const mySafes = useSafeList('safes')
  const recent = useSafeList('recent')
  const addressBook = useAddressBook()
  const save = useSaveSafe('safes')
  const { selectedSafe, selectSafe } = useSelectedSafe()
  const [temporary, setTemporary] = useState<SelectedSafe[]>([])
  const [warning, setWarning] = useState<{ safe: SelectedSafe; text: string }>()
  const bridge = useRef<ReturnType<typeof createRotationsBridge> | undefined>(undefined)
  const ready = !mySafes.isPending && !recent.isPending && !addressBook.isPending
  const context = useMemo<SafeContext>(() => {
    const safes = mergeSafeChoices(
      mySafes.data?.safes ?? [],
      recent.data?.safes ?? [],
      addressBook.data?.entries ?? [],
      temporary,
    )
    const selected =
      safes.find((safe) => selectedSafeKey(safe) === selectedSafeKey(selectedSafe)) ?? selectedSafe
    return { safes, ...(selected ? { selectedSafe: selected } : {}) }
  }, [mySafes.data, recent.data, addressBook.data, temporary, selectedSafe])
  const latest = useRef({ context, mySafes: mySafes.data, save: save.mutateAsync })
  latest.current = { context, mySafes: mySafes.data, save: save.mutateAsync }
  useEffect(() => {
    if (!host.current || !ready) return
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    const additions = createSafeAdditionHandler({
      onChoice: (safe) =>
        setTemporary((rows) => [
          ...rows.filter((row) => selectedSafeKey(row) !== selectedSafeKey(safe)),
          safe,
        ]),
      onStatus: (safe, text) => setWarning(text ? { safe, text } : undefined),
      verify: verifiedSafeRecord,
      existing: (safe) =>
        latest.current.mySafes?.safes.find((row) => selectedSafeKey(row) === selectedSafeKey(safe)),
      save: (record) => latest.current.save(record),
    })
    const mounted = createRotationsBridge(
      (options) => {
        const template = new DOMParser().parseFromString(markup, 'text/html')
        template.querySelectorAll('script, nav, .desk-brand-credit').forEach((node) => {
          node.remove()
        })
        const title = template.querySelector('h1')
        if (title) title.textContent = 'Safe Ownership Management'
        const style = document.createElement('style')
        style.textContent =
          css.replaceAll(':root', ':host') +
          '\n:host {display:block;} header{background:transparent;border:0;padding:24px 16px 0;} main{padding:16px;} @media(min-width:900px){header{padding:24px 28px 0;} main{padding:20px 28px;}}'
        root.replaceChildren(style, ...Array.from(template.body.childNodes))
        return mountRotations(root, {
          ...options,
          renderIcons: (target) => createIcons({ icons, root: target }),
        })
      },
      {
        onSafeSelected: selectSafe,
        onSafeAdded: (safe) => {
          void additions.add(safe)
        },
        onBusy: (busy) => {
          if (busy) window.addEventListener('beforeunload', warnBeforeUnload)
          else window.removeEventListener('beforeunload', warnBeforeUnload)
        },
      },
    )
    bridge.current = mounted
    mounted.update(latest.current.context)
    return () => {
      additions.dispose()
      bridge.current = undefined
      mounted.dispose()
      window.removeEventListener('beforeunload', warnBeforeUnload)
      root.replaceChildren()
    }
  }, [ready, selectSafe])
  useEffect(() => {
    bridge.current?.update(context)
  }, [context])
  return (
    <>
      {!ready && (
        <p role="status" className="px-4 py-4 text-sm text-muted-foreground">
          Loading saved Safes...
        </p>
      )}
      {(mySafes.error || recent.error || addressBook.error) && (
        <p role="alert" className="px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Some saved Safe choices could not be read.
        </p>
      )}
      {warning && <SafeAdditionStatus {...warning} />}
      <div ref={host} data-testid="rotations-workspace" />
    </>
  )
}

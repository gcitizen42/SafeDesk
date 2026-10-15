import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SafeSnapshot } from './load-safe'
import {
  createSelectedSafeStore,
  mergeSafeChoices,
  normalizeSelectedSafe,
  safeChoiceLabel,
  selectedSafeFromRoute,
  selectedSafeKey,
  useSelectedSafe,
  verifiedSafeRecord,
} from './selected-safe'

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const hash = `0x${'11'.repeat(32)}` as const
const snapshot: SafeSnapshot = {
  chainId: 1,
  address: A,
  singleton: B,
  block: 123n,
  nonce: 7n,
  threshold: 2n,
  owners: [A, B],
  balance: 0n,
  reportedVersion: 'untrusted',
  authenticity: {
    status: 'verified',
    version: '1.4.1',
    singleton: B,
    singletonName: 'Safe',
    codeHash: hash,
    l2: false,
    proxy: { codeHash: hash, size: 1, factories: [] },
  },
}

describe('shared Safe selection', () => {
  it('tracks the viewed Safe and every queue/review child without mixing configured chains', () => {
    for (const suffix of [
      '',
      '/queue',
      '/history',
      '/new/raw',
      '/tx/hash',
      '/review',
      '/queue?view=pending',
    ])
      expect(selectedSafeFromRoute(`/safe/1/${A}${suffix}`, [1, 60808])).toEqual({
        chainId: 1,
        address: A,
      })
    expect(selectedSafeFromRoute(`/safe/60808/${A}/queue`, [1, 60808])).toEqual({
      chainId: 60808,
      address: A,
    })
    for (const route of [
      `/safe/10/${A}`,
      `/safe/0/${A}`,
      `/safe/1/${A}bad`,
      '/safe/1/not-an-address',
      '/rotations',
      '/other-chains',
    ])
      expect(selectedSafeFromRoute(route, [1, 60808])).toBeUndefined()
  })

  it('retains identity across tab navigation and changes it when either chain or address changes', () => {
    const store = createSelectedSafeStore()
    store.select(selectedSafeFromRoute(`/safe/1/${A}/queue`, [1, 60808]))
    expect(store.getSnapshot()).toEqual({ chainId: 1, address: A })
    // Navigating to a workspace tab supplies no new Safe and does not clear the selection.
    store.select(selectedSafeFromRoute('/rotations', [1, 60808]))
    expect(store.getSnapshot()?.address).toBe(A)
    store.select({ chainId: 60808, address: A })
    expect(selectedSafeKey(store.getSnapshot())).toBe(`60808:${A}`)
    store.select({ chainId: 60808, address: B })
    expect(store.getSnapshot()).toEqual({ chainId: 60808, address: B })
  })

  it('does not let late restoration replace a more recent route choice', async () => {
    const store = createSelectedSafeStore()
    let resolve: (value: unknown) => void = () => undefined
    const restored = store.restore(
      () =>
        new Promise((yes) => {
          resolve = yes
        }),
    )
    store.select({ chainId: 60808, address: B })
    resolve({ chainId: 1, address: A })
    await restored
    expect(store.getSnapshot()).toEqual({ chainId: 60808, address: B })
    const clean = createSelectedSafeStore()
    await clean.restore(async () => ({ chainId: 1, address: A }))
    expect(clean.getSnapshot()).toEqual({ chainId: 1, address: A })
  })

  it('exposes a React hook and only stores public identity/labels, never callback RPCs or signatures', () => {
    const value = normalizeSelectedSafe({
      chainId: 1,
      address: A,
      label: ' Treasury ',
      rpc: 'private endpoint',
      signatures: ['sensitive'],
    })
    expect(value).toEqual({ chainId: 1, address: A, label: 'Treasury' })
    expect(normalizeSelectedSafe({ chainId: -1, address: A })).toBeUndefined()
    expect(normalizeSelectedSafe({ chainId: 1, address: 'https://invalid' })).toBeUndefined()
    function Probe() {
      const { selectedSafe } = useSelectedSafe()
      return createElement('span', null, selectedSafe?.address ?? 'No selection')
    }
    expect(renderToStaticMarkup(createElement(Probe))).toContain('No selection')
  })

  it('merges My Safes and Recent case-insensitively with chain-specific labels and stable row descriptions', () => {
    const rows = mergeSafeChoices(
      [
        { chainId: 1, address: A },
        { chainId: 60808, address: A },
      ],
      [
        { chainId: 1, address: A },
        { chainId: 1, address: B },
      ],
      [
        { chainId: '*', address: A, label: 'Global' },
        { chainId: 60808, address: A, label: 'BOB treasury' },
      ],
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]?.label).toBe('Global')
    expect(rows[1]?.label).toBe('BOB treasury')
    expect(safeChoiceLabel(rows[1], 'BOB')).toBe('BOB treasury / 0x111111...111111 / BOB')
    expect(safeChoiceLabel(rows[2])).toBe('0x222222...222222 / Chain 1')
    expect(
      rows.every((row) =>
        Object.keys(row).every((key) => ['chainId', 'address', 'label'].includes(key)),
      ),
    ).toBe(true)
  })
})

describe('Ownership Manager Safe additions', () => {
  it('uses the frontend authenticity result, not VERSION() or a backend owner list', async () => {
    const read = vi.fn(async () => snapshot)
    const record = await verifiedSafeRecord({ chainId: 1, address: A }, read)
    expect(read).toHaveBeenCalledWith(1, A)
    expect(record).toMatchObject({
      chainId: 1,
      address: A,
      version: '1.4.1',
      lastSeen: { nonce: '7', threshold: '2' },
    })
    expect(
      await verifiedSafeRecord({ chainId: 1, address: A }, async () => ({
        ...snapshot,
        authenticity: { status: 'unknown-proxy', codeHash: hash },
      })),
    ).toBeUndefined()
    expect(
      await verifiedSafeRecord(
        { chainId: 1, address: A },
        async () =>
          ({ chainId: 1, address: A, owners: [A], threshold: 1n }) as unknown as SafeSnapshot,
      ),
    ).toBeUndefined()
  })

  it('rejects stale or wrong-chain/address reads instead of turning them into My Safes records', async () => {
    expect(
      await verifiedSafeRecord({ chainId: 60808, address: A }, async () => snapshot),
    ).toBeUndefined()
    expect(
      await verifiedSafeRecord({ chainId: 1, address: B }, async () => snapshot),
    ).toBeUndefined()
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  createSelectedSafeStore,
  type SafeContext,
  selectedSafeKey,
} from '@/features/safes/selected-safe'
import type { SafeRecord } from '@/schemas/safes'
import {
  createRotationsBridge,
  createSafeAdditionHandler,
  RotationsScreen,
  SafeAdditionStatus,
} from './rotations-screen'

vi.mock('../../../../../scripts/safe-batch/dashboard.mjs', () => ({ mountRotations: vi.fn() }))
vi.mock('@/queries/safes', () => ({
  useSafeList: () => ({ data: { safes: [] }, isPending: false }),
  useAddressBook: () => ({ data: { entries: [] }, isPending: false }),
  useSaveSafe: () => ({ mutateAsync: vi.fn() }),
}))
const A = { chainId: 1, address: '0x1111111111111111111111111111111111111111' }
const B = { chainId: 60808, address: A.address }
const C = { chainId: 60808, address: '0x2222222222222222222222222222222222222222' }
const record: SafeRecord = {
  ...C,
  address: C.address as SafeRecord['address'],
  version: '1.4.1',
  l2: false,
  addedAt: '2026-10-14T00:00:00.000Z',
}

function setup() {
  const options: Parameters<Parameters<typeof createRotationsBridge>[0]>[0][] = []
  const disposers: ReturnType<typeof vi.fn>[] = []
  const mount = vi.fn((value: (typeof options)[number]) => {
    options.push(value)
    const dispose = vi.fn()
    disposers.push(dispose)
    return dispose
  })
  const callbacks = { onSafeSelected: vi.fn(), onSafeAdded: vi.fn(), onBusy: vi.fn() }
  return { bridge: createRotationsBridge(mount, callbacks), mount, options, disposers, callbacks }
}

describe('Ownership Manager shared Safe bridge', () => {
  it('provides the current Safe and both saved lists through the agreed getter contract', () => {
    const { bridge, options, mount } = setup()
    const context: SafeContext = { selectedSafe: B, safes: [A, B, C] }
    bridge.update(context)
    expect(options[0]?.getSafeContext()).toEqual(context)
    expect(mount).toHaveBeenCalledTimes(1)
  })

  it('keeps lists and labels current without remounting a prepared/signing wizard', () => {
    const { bridge, options, mount } = setup()
    bridge.update({ selectedSafe: A, safes: [A] })
    bridge.update({ selectedSafe: { ...A, label: 'Treasury' }, safes: [A, B] })
    expect(mount).toHaveBeenCalledTimes(1)
    expect(options[0]?.getSafeContext()).toEqual({
      selectedSafe: { ...A, label: 'Treasury' },
      safes: [A, B],
    })
  })

  it('defers chain/address changes until the busy callback completes and applies only the latest choice', async () => {
    const { bridge, options, mount, disposers } = setup()
    bridge.update({ selectedSafe: A, safes: [A, B, C] })
    options[0]?.onBusy(true)
    bridge.update({ selectedSafe: B, safes: [A, B, C] })
    bridge.update({ selectedSafe: C, safes: [A, B, C] })
    expect(mount).toHaveBeenCalledTimes(1)
    expect(options[0]?.getSafeContext().selectedSafe).toEqual(A)
    options[0]?.onBusy(false)
    expect(mount).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(mount).toHaveBeenCalledTimes(2)
    expect(disposers[0]).toHaveBeenCalledTimes(1)
    expect(options[1]?.getSafeContext().selectedSafe).toEqual(C)
  })

  it('does not select or remount when inspection adds a Safe during the wizard', async () => {
    const { bridge, options, callbacks, mount, disposers } = setup()
    bridge.update({ selectedSafe: A, safes: [A] })
    options[0]?.onBusy(true)
    options[0]?.onSafeAdded(C)
    bridge.update({ selectedSafe: A, safes: [A, C] })
    options[0]?.onBusy(false)
    await Promise.resolve()
    expect(callbacks.onSafeAdded).toHaveBeenCalledWith(C)
    expect(callbacks.onSafeSelected).not.toHaveBeenCalled()
    expect(options[0]?.getSafeContext()).toEqual({ selectedSafe: A, safes: [A, C] })
    expect(mount).toHaveBeenCalledTimes(1)
    expect(disposers[0]).not.toHaveBeenCalled()
  })

  it('retains the freshly opened wizard when its own selection is reflected by My Safes', async () => {
    const { bridge, options, callbacks, mount, disposers } = setup()
    bridge.update({ selectedSafe: A, safes: [A, B] })
    options[0]?.onBusy(true)
    options[0]?.onBusy(false)
    options[0]?.onSafeSelected(B)
    bridge.update({ selectedSafe: B, safes: [A, B] })
    await Promise.resolve()
    expect(callbacks.onSafeSelected).toHaveBeenCalledWith(B)
    expect(options[0]?.getSafeContext().selectedSafe).toEqual(B)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(disposers[0]).not.toHaveBeenCalled()
    bridge.update({ selectedSafe: C, safes: [A, B, C] })
    expect(mount).toHaveBeenCalledTimes(2)
  })

  it('switches the same address between chains and rejects stale/disposed or busy selection callbacks', () => {
    const { bridge, options, callbacks, mount } = setup()
    bridge.update({ selectedSafe: A, safes: [A, B] })
    bridge.update({ selectedSafe: B, safes: [A, B] })
    expect(mount).toHaveBeenCalledTimes(2)
    expect(selectedSafeKey(options[1]?.getSafeContext().selectedSafe)).toBe(`60808:${A.address}`)
    expect(options[0]?.getSafeContext().selectedSafe).toEqual(A)
    options[0]?.onSafeSelected(A)
    options[1]?.onBusy(true)
    options[1]?.onSafeSelected(C)
    expect(callbacks.onSafeSelected).not.toHaveBeenCalled()
    options[1]?.onBusy(false)
    options[1]?.onSafeSelected(C)
    expect(callbacks.onSafeSelected).toHaveBeenCalledWith(C)
    bridge.dispose()
    options[1]?.onSafeAdded(A)
    options[1]?.onBusy(true)
    expect(callbacks.onSafeAdded).not.toHaveBeenCalled()
  })

  it('sanitizes Safe-added callbacks and does not assume minimal owner metadata proves authenticity', () => {
    const { bridge, options, callbacks } = setup()
    bridge.update({ selectedSafe: A, safes: [A] })
    options[0]?.onSafeAdded({
      ...C,
      owners: ['untrusted'],
      rpc: 'private',
      signatures: ['sensitive'],
    } as typeof C)
    expect(callbacks.onSafeAdded).toHaveBeenCalledWith(C)
    options[0]?.onSafeAdded({ chainId: -1, address: 'not-an-address' })
    expect(callbacks.onSafeAdded).toHaveBeenCalledTimes(1)
  })

  it('renders the existing workspace without a wallet or network action during rendering', () => {
    const markup = renderToStaticMarkup(createElement(RotationsScreen))
    expect(markup).toContain('data-testid="rotations-workspace"')
  })
})

describe('Ownership Manager inspected Safe additions', () => {
  it('renders the inspected Safe warning while another chain is selected, even after selection changes', async () => {
    const selection = createSelectedSafeStore()
    selection.select(A)
    let status: { safe: typeof B; text: string } | undefined
    const additions = createSafeAdditionHandler({
      onChoice: vi.fn(),
      onStatus: (safe, text) => {
        status = text ? { safe, text } : undefined
      },
      save: vi.fn(),
      existing: () => undefined,
      verify: async () => {
        throw new Error('private RPC details')
      },
    })
    await additions.add(B)
    expect(selection.getSnapshot()).toEqual(A)
    expect(status).toBeDefined()
    if (!status) throw new Error('Expected an inspected Safe warning')
    const result = renderToStaticMarkup(createElement(SafeAdditionStatus, status))
    expect(result).toContain('role="status"')
    expect(result).toContain('0x111111...111111 / Chain 60808')
    expect(result).toContain('Could not verify or save this Safe')
    expect(result).not.toContain('Chain 1')
    expect(result).not.toContain('private RPC details')
    selection.select(C)
    expect(renderToStaticMarkup(createElement(SafeAdditionStatus, status))).toBe(result)
    expect(selection.getSnapshot()).toEqual(C)
  })

  it('retains an unverified temporary choice with a warning, without selecting or saving it', async () => {
    const selection = createSelectedSafeStore()
    selection.select(A)
    const onChoice = vi.fn()
    const onStatus = vi.fn()
    const save = vi.fn()
    const additions = createSafeAdditionHandler({
      onChoice,
      onStatus,
      save,
      existing: () => undefined,
      verify: async () => undefined,
    })
    await additions.add(C)
    expect(onChoice).toHaveBeenCalledWith(C)
    expect(save).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith(C, expect.stringContaining('not added to My Safes'))
    expect(selection.getSnapshot()).toEqual(A)
  })

  it('saves only after verification, preserves addedAt, and never changes scope after switching Safes', async () => {
    const selection = createSelectedSafeStore()
    selection.select(A)
    let resolve: (value: SafeRecord | undefined) => void = () => undefined
    const save = vi.fn(async (_record: SafeRecord) => undefined)
    const onStatus = vi.fn()
    const additions = createSafeAdditionHandler({
      onChoice: vi.fn(),
      onStatus,
      save,
      existing: () => ({ ...record, addedAt: '2025-01-01T00:00:00.000Z' }),
      verify: () =>
        new Promise((yes) => {
          resolve = yes
        }),
    })
    const pending = additions.add(C)
    expect(save).not.toHaveBeenCalled()
    selection.select(B)
    resolve(record)
    await pending
    expect(save).toHaveBeenCalledWith({ ...record, addedAt: '2025-01-01T00:00:00.000Z' })
    expect(selection.getSnapshot()).toEqual(B)
    expect(onStatus).toHaveBeenLastCalledWith(C, undefined)
  })

  it('does not let older verification overwrite the latest notice or a disposed wizard save a Safe', async () => {
    const pending: ((value: SafeRecord | undefined) => void)[] = []
    const save = vi.fn(async (_record: SafeRecord) => undefined)
    const onStatus = vi.fn()
    const additions = createSafeAdditionHandler({
      onChoice: vi.fn(),
      onStatus,
      save,
      existing: () => undefined,
      verify: () =>
        new Promise((yes) => {
          pending.push(yes)
        }),
    })
    const older = additions.add(A)
    const newer = additions.add(C)
    const calls = onStatus.mock.calls.length
    pending[0]?.(undefined)
    await older
    expect(onStatus).toHaveBeenCalledTimes(calls)
    additions.dispose()
    pending[1]?.(record)
    await newer
    expect(save).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenCalledTimes(calls)
  })

  it('discards superseded same-Safe reads and exposes only a generic failure notice', async () => {
    const pending: ((value: SafeRecord | undefined) => void)[] = []
    const save = vi.fn(async (_record: SafeRecord) => {
      throw new Error('private RPC payload')
    })
    const onStatus = vi.fn()
    const additions = createSafeAdditionHandler({
      onChoice: vi.fn(),
      onStatus,
      save,
      existing: () => undefined,
      verify: () =>
        new Promise((yes) => {
          pending.push(yes)
        }),
    })
    const older = additions.add(C)
    const newer = additions.add(C)
    pending[0]?.(record)
    await older
    expect(save).not.toHaveBeenCalled()
    pending[1]?.(record)
    await newer
    expect(save).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenLastCalledWith(
      C,
      expect.stringContaining('Could not verify or save'),
    )
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain('private RPC payload')
  })
})

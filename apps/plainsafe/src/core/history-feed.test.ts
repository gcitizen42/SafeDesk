import { type Hex, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import type { HistoryEvent } from '@/schemas/history'
import { buildFeed, feedItemKey, groupByDay } from './history-feed'

const A = '0x000000000000000000000000000000000000000A'
const B = '0x000000000000000000000000000000000000000b'
const C = '0x000000000000000000000000000000000000000C'
const D = '0x000000000000000000000000000000000000000d'
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex

let log = 0
const ev = (
  block: number,
  txn: number,
  name: string,
  args: HistoryEvent['args'] = {},
): HistoryEvent => ({
  blockNumber: String(block),
  logIndex: log++,
  transactionHash: tx(txn),
  name,
  args,
})
const exec = (block: number, txn: number) =>
  ev(block, txn, 'ExecutionSuccess', { txHash: tx(900 + txn), payment: '0' })

describe('history feed (SPEC §11)', () => {
  const setup = ev(10, 1, 'SafeSetup', {
    initiator: A,
    owners: [A, B],
    threshold: '1',
    initializer: zeroAddress,
    fallbackHandler: zeroAddress,
  })
  // An execution that adds C and raises the threshold, logged before its ExecutionSuccess
  const addC = ev(20, 2, 'AddedOwner', { owner: C })
  const raise = ev(20, 2, 'ChangedThreshold', { threshold: '2' })
  const exec2 = exec(20, 2)
  // ETH sent in by someone else: its own item
  const received = ev(25, 3, 'SafeReceived', { sender: D, value: '1000' })
  // swapOwner(A → D): RemovedOwner then AddedOwner
  const removeA = ev(30, 4, 'RemovedOwner', { owner: A })
  const addD = ev(30, 4, 'AddedOwner', { owner: D })
  const exec4 = exec(30, 4)
  // An L2 execution: its parameters come first
  const l2 = ev(40, 5, 'SafeMultiSigTransaction', { to: B, value: '0', data: '0x' })
  const exec5 = exec(40, 5)
  // Two executions in one transaction, each with its own owner change
  const removeC = ev(50, 6, 'RemovedOwner', { owner: C })
  const lower = ev(50, 6, 'ChangedThreshold', { threshold: '1' })
  const exec6a = exec(50, 6)
  const addC2 = ev(50, 6, 'AddedOwner', { owner: C })
  const exec6b = exec(50, 6)
  const all = [
    setup,
    addC,
    raise,
    exec2,
    received,
    removeA,
    addD,
    exec4,
    l2,
    exec5,
    removeC,
    lower,
    exec6a,
    addC2,
    exec6b,
  ]

  it('folds what an execution logged into it, newest first', () => {
    // Stored order doesn't matter
    const feed = buildFeed([...all].reverse())
    expect(feed.map((i) => `${i.kind}:${i.event.name}:${i.event.blockNumber}`)).toEqual([
      'execution:ExecutionSuccess:50',
      'execution:ExecutionSuccess:50',
      'execution:ExecutionSuccess:40',
      'execution:ExecutionSuccess:30',
      'event:SafeReceived:25',
      'execution:ExecutionSuccess:20',
      'event:SafeSetup:10',
    ])
    const at = (e: HistoryEvent) =>
      feed.find((i) => feedItemKey(i) === `${e.blockNumber}:${e.logIndex}`)
    const second = at(exec2)
    expect(second?.kind === 'execution' && second.effects).toEqual([addC, raise])
    const l2Item = at(exec5)
    expect(l2Item?.kind === 'execution' && l2Item.detail).toEqual(l2)
    expect(l2Item?.kind === 'execution' && l2Item.effects).toEqual([])
    const a = at(exec6a)
    const b = at(exec6b)
    expect(a?.kind === 'execution' && a.effects).toEqual([removeC, lower])
    expect(b?.kind === 'execution' && b.effects).toEqual([addC2])
  })

  it('knows the owners and threshold each execution ran under', () => {
    const feed = buildFeed(all)
    const byBlock = (block: string, n = 0) =>
      feed.filter((i) => i.event.blockNumber === block && i.kind === 'execution')[n]
    const e2 = byBlock('20')
    expect(e2?.kind === 'execution' && e2.threshold).toBe(1)
    expect(e2?.kind === 'execution' && e2.owners).toEqual({
      added: [C],
      removed: [],
      before: [A, B],
      after: [C, A, B],
      thresholdBefore: 1,
      thresholdAfter: 2,
    })
    const e4 = byBlock('30')
    expect(e4?.kind === 'execution' && e4.threshold).toBe(2)
    expect(e4?.kind === 'execution' && e4.owners).toMatchObject({
      added: [D],
      removed: [A],
      before: [C, A, B],
      after: [D, C, B],
      thresholdBefore: 2,
      thresholdAfter: 2,
    })
    // A plain execution changes nothing
    const e5 = byBlock('40')
    expect(e5?.kind === 'execution' && e5.owners).toBeUndefined()
    // In the same transaction, the second execution starts where the first left off
    const [e6b, e6a] = [byBlock('50', 0), byBlock('50', 1)]
    expect(e6a?.kind === 'execution' && e6a.owners).toMatchObject({
      after: [D, B],
      thresholdAfter: 1,
    })
    expect(e6b?.kind === 'execution' && e6b.threshold).toBe(1)
    expect(e6b?.kind === 'execution' && e6b.owners).toMatchObject({
      added: [C],
      before: [D, B],
      after: [C, D, B],
    })
  })

  it('gives only the differences when the creation is not in the history', () => {
    const feed = buildFeed(all.filter((e) => e !== setup))
    const e2 = feed.find((i) => i.event === exec2)
    expect(e2?.kind === 'execution' && e2.threshold).toBeUndefined()
    expect(e2?.kind === 'execution' && e2.owners).toEqual({
      added: [C],
      removed: [],
      thresholdAfter: 2,
    })
    // Later executions know the threshold from the ChangedThreshold they saw
    const e4 = feed.find((i) => i.event === exec4)
    expect(e4?.kind === 'execution' && e4.threshold).toBe(2)
  })

  it('treats an owner removed and added back in one execution as no change', () => {
    const r = ev(60, 7, 'RemovedOwner', { owner: B })
    const a = ev(60, 7, 'AddedOwner', { owner: B })
    const feed = buildFeed([setup, r, a, exec(60, 7)])
    expect(feed[0]?.kind === 'execution' && feed[0].owners).toMatchObject({
      added: [],
      removed: [],
    })
  })
})

describe('groupByDay', () => {
  it('groups consecutive items by day and keeps undated ones apart', () => {
    const items = [
      { id: 1, day: '2026-09-22' },
      { id: 2, day: '2026-09-14' },
      { id: 3, day: '2026-09-14' },
      { id: 4, day: undefined },
      { id: 5, day: '2026-08-07' },
    ]
    expect(groupByDay(items, (i) => i.day).map((g) => [g.day, g.items.map((i) => i.id)])).toEqual([
      ['2026-09-22', [1]],
      ['2026-09-14', [2, 3]],
      [undefined, [4]],
      ['2026-08-07', [5]],
    ])
  })
})

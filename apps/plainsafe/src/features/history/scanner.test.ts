import { Effect, Layer } from 'effect'
import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { safeEventsV141 } from '@/core/history'
import { HistoryCheckpoint, HistoryEvent, historyEventPrefix, historyKey } from '@/schemas/history'
import { makeStorage, memoryBackend, Storage } from '@/storage/service'
import { type HistoryClient, type HistoryLog, scanHistory } from './scanner'

const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
/** A block's timestamp on the fake chain. */
const timeOf = (block: bigint) => 1_700_000_000n + block * 12n
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex
const execution = (block: bigint, n: number): HistoryLog => ({
  blockNumber: block,
  logIndex: 0,
  transactionHash: hash(1000 + n),
  topics: encodeEventTopics({
    abi: safeEventsV141,
    eventName: 'ExecutionSuccess',
    args: { txHash: hash(n) },
  }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
})
const setupLog = (block: bigint): HistoryLog => ({
  blockNumber: block,
  logIndex: 1,
  transactionHash: hash(999),
  topics: encodeEventTopics({
    abi: safeEventsV141,
    eventName: 'SafeSetup',
    args: { initiator: SAFE },
  }) as Hex[],
  data: encodeAbiParameters(
    [{ type: 'address[]' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [[SAFE], 1n, zeroAddress, zeroAddress],
  ),
})

/** A chain with a Safe created at block 1000 and an RPC that refuses ranges over 3,000 blocks. */
function fakeChain(opts: { refuse?: boolean; flaky?: boolean } = {}) {
  const state = {
    latest: 9_600n,
    finalized: 9_500n,
    nonce: 4n,
    logs: [
      setupLog(1_000n),
      execution(2_000n, 1),
      execution(5_000n, 2),
      execution(9_000n, 3),
      execution(9_550n, 4),
    ],
    calls: [] as [bigint, bigint][],
    headers: [] as bigint[],
  }
  const client: HistoryClient = {
    latestBlock: async () => state.latest,
    finalizedBlock: async () => state.finalized,
    nonce: async () => state.nonce,
    blockTimestamp: async (block) => {
      state.headers.push(block)
      return timeOf(block)
    },
    getLogs: async ({ fromBlock, toBlock }) => {
      state.calls.push([fromBlock, toBlock])
      if (opts.refuse) throw new Error('4444 pruned history unavailable')
      // The first two calls fail, the way MEV Blocker's getLogs does at times
      if (opts.flaky && state.calls.length <= 2) throw new Error('service temporarily unavailable')
      if (toBlock - fromBlock + 1n > 3_000n) throw new Error('query exceeds max block range 3000')
      return state.logs.filter(
        (l) => l.blockNumber !== null && l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
      )
    },
  }
  return { state, client }
}

function setup() {
  const backend = memoryBackend()
  const layer = Layer.succeed(Storage, makeStorage(backend))
  const run = <A, E>(eff: Effect.Effect<A, E, Storage>) =>
    Effect.runPromise(Effect.provide(eff, layer))
  return { run }
}
const target = { chainId: 1, safe: SAFE, version: '1.4.1', floor: 500n, rpcUrl: 'https://rpc' }
const ignore = () => {}
const stored = (run: ReturnType<typeof setup>['run']) =>
  run(
    Effect.gen(function* () {
      const s = yield* Storage
      const events = yield* s.getAllWithPrefix(
        'history_events',
        historyEventPrefix(1, SAFE),
        HistoryEvent,
      )
      const cp = yield* s.get('history_checkpoints', historyKey(1, SAFE), HistoryCheckpoint)
      return {
        events: events.records.map((r) => `${r.value.blockNumber}:${r.value.name}`),
        timestamps: events.records.map((r) => r.value.timestamp),
        cp,
      }
    }),
  )

describe('history scanner (SPEC §11)', () => {
  it('scans back to the creation, halving on range errors, with the tip kept apart', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    const result = await run(scanHistory(client, target, ignore))
    expect(result).toMatchObject({ status: 'complete', executions: 4, onchainNonce: 4n })
    const { events, cp } = await stored(run)
    expect(events).toEqual([
      '1000:SafeSetup',
      '2000:ExecutionSuccess',
      '5000:ExecutionSuccess',
      '9000:ExecutionSuccess',
    ])
    expect(cp._tag === 'Some' && cp.value.tip.map((e) => e.blockNumber)).toEqual(['9550'])
    // The tip window is read first. Then the first backward attempt (100,000 blocks) was too
    // large; every accepted range was at most 3,000
    expect(state.calls.slice(0, 2)).toEqual([
      [9_501n, 9_600n],
      [500n, 9_500n],
    ])
    expect(state.calls.every(([f, t]) => t >= f)).toBe(true)
  })

  it('resumes after being stopped without re-reading what it stored', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    // Stopped right after its first chunk is committed, the way terminating the worker stops it
    const stop = () => {
      throw new Error('terminated')
    }
    await expect(run(scanHistory(client, target, stop))).rejects.toThrow('terminated')
    const { cp } = await stored(run)
    const scannedDownTo = BigInt(cp._tag === 'Some' ? (cp.value.scannedDownTo ?? '0') : '0')
    expect(scannedDownTo).toBeGreaterThan(target.floor)
    state.calls = []
    const second = await run(scanHistory(client, target, ignore))
    expect(second.status).toBe('complete')
    const backward = state.calls.filter(([, t]) => t <= state.finalized)
    expect(backward.every(([, t]) => t < scannedDownTo)).toBe(true)
  })

  it('catches up forward on the next run', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    await run(scanHistory(client, target, ignore))
    state.logs.push(execution(9_700n, 5))
    state.finalized = 9_800n
    state.latest = 9_900n
    state.nonce = 5n
    const counts: number[] = []
    const r = await run(scanHistory(client, target, (p) => counts.push(p.executions)))
    expect(r).toMatchObject({ status: 'complete', executions: 5 })
    // 9,550 moves from the tip to the stored events, and is never counted twice
    expect(Math.max(...counts)).toBe(5)
    const { events } = await stored(run)
    expect(events).toContain('9550:ExecutionSuccess')
    expect(events).toContain('9700:ExecutionSuccess')
  })

  it("doesn't scan back at all for a Safe created above the finalized block", async () => {
    // A new Safe (0xdA1c…D3F9 on Sepolia): SafeSetup at 11,787,498, finalized at 11,787,454,
    // nonce 0. Below the creation there's nothing to find, down to the floor 7.9M blocks away.
    const { run } = setup()
    const { client, state } = fakeChain()
    state.latest = 11_787_526n
    state.finalized = 11_787_454n
    state.nonce = 0n
    state.logs = [setupLog(11_787_498n)]
    const r = await run(scanHistory(client, { ...target, floor: 3_921_533n }, ignore))
    expect(r).toMatchObject({ status: 'complete', executions: 0, onchainNonce: 0n })
    expect(state.calls).toEqual([[11_787_455n, 11_787_526n]])
  })

  it('counts a creation found by the forward catch-up', async () => {
    // A scan that started while the creation was above the finalized block and walked past it
    const { run } = setup()
    const { client, state } = fakeChain()
    state.logs = [setupLog(9_550n)]
    state.nonce = 0n
    await run(
      Effect.flatMap(Storage, (s) =>
        s.put('history_checkpoints', historyKey(1, SAFE), HistoryCheckpoint, {
          chainId: 1,
          safe: SAFE,
          version: '1.4.1',
          enabled: true,
          floor: '500',
          rpcUrl: 'https://rpc',
          finalizedHead: '9500',
          scannedDownTo: '5000',
          chunkSize: '3000',
          setupFound: false,
          status: 'scanning',
          tip: [],
          updatedAt: new Date().toISOString(),
        }),
      ),
    )
    state.finalized = 9_700n
    state.latest = 9_800n
    const r = await run(scanHistory(client, target, ignore))
    expect(r.status).toBe('complete')
    // Nothing below the old head was read again
    expect(state.calls.every(([f]) => f > 9_500n)).toBe(true)
  })

  it('is incomplete when the floor is reached without the creation', async () => {
    const { run } = setup()
    const { client } = fakeChain()
    const r = await run(scanHistory(client, { ...target, floor: 1_500n }, ignore))
    expect(r.status).toBe('incomplete')
  })

  it('retries temporary errors instead of giving up', async () => {
    const { run } = setup()
    const { client } = fakeChain({ flaky: true })
    const r = await run(scanHistory(client, target, ignore))
    expect(r.status).toBe('complete')
  }, 10_000)

  it('dates events from the log when the node sends the timestamp, else from the header', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    // This node includes blockTimestamp for one of the logs only
    state.logs = state.logs.map((l) =>
      l.blockNumber === 5_000n ? { ...l, blockTimestamp: timeOf(5_000n) } : l,
    )
    await run(scanHistory(client, target, ignore))
    const { timestamps, cp } = await stored(run)
    expect(timestamps).toEqual([1_000n, 2_000n, 5_000n, 9_000n].map((b) => timeOf(b).toString()))
    expect(cp._tag === 'Some' && cp.value.tip[0]?.timestamp).toBe(timeOf(9_550n).toString())
    // One header read per block without a timestamp, none for 5,000
    expect([...state.headers].sort()).toEqual([1_000n, 2_000n, 9_000n, 9_550n].sort())
  })

  it('dates events stored before timestamps were kept', async () => {
    const { run } = setup()
    const { client, state } = fakeChain()
    await run(scanHistory(client, target, ignore))
    // Strip the timestamps, as a history stored by an earlier version would be
    await run(
      Effect.gen(function* () {
        const s = yield* Storage
        const all = yield* s.getAllWithPrefix(
          'history_events',
          historyEventPrefix(1, SAFE),
          HistoryEvent,
        )
        for (const r of all.records) {
          const { timestamp: _, ...old } = r.value
          yield* s.put('history_events', r.key, HistoryEvent, old)
        }
      }),
    )
    expect((await stored(run)).timestamps.every((t) => t === undefined)).toBe(true)
    state.headers = []
    const r = await run(scanHistory(client, target, ignore))
    expect(r.status).toBe('complete')
    expect((await stored(run)).timestamps).toEqual(
      [1_000n, 2_000n, 5_000n, 9_000n].map((b) => timeOf(b).toString()),
    )
  })

  it('keeps an event undated when its header cannot be read', async () => {
    const { run } = setup()
    const { client } = fakeChain()
    const r = await run(
      scanHistory(
        { ...client, blockTimestamp: async () => Promise.reject(new Error('method not found')) },
        target,
        ignore,
      ),
    )
    expect(r.status).toBe('complete')
    expect((await stored(run)).timestamps.every((t) => t === undefined)).toBe(true)
  })

  it('is unavailable when the RPC refuses historical logs', async () => {
    const { run } = setup()
    const { client } = fakeChain({ refuse: true })
    const r = await run(scanHistory(client, target, ignore))
    expect(r.status).toBe('unavailable')
    expect(r.reason).toMatch(/doesn't serve historical logs/)
  })
})

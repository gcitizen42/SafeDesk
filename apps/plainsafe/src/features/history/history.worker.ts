// The history worker (SPEC §11): scans one Safe's logs off the main thread, so it keeps going in
// background tabs.
// netguard must be the first import: this worker has its own fetch (SPEC §8.1). Keep it first.
import './worker-netguard'

import { Effect } from 'effect'
import { type Address, createPublicClient, http, parseAbi } from 'viem'
import { historyKey } from '@/schemas/history'
import { StorageLive } from '@/storage/service'
import { type Broadcast, CHANNEL, lockName, type ToWorker } from './protocol'
import { type HistoryClient, type ScanProgress, type ScanTarget, scanHistory } from './scanner'
import { netguard, post } from './worker-netguard'

const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL)

const nonceAbi = parseAbi(['function nonce() view returns (uint256)'])

function clientFor(rpcUrl: string): HistoryClient {
  const client = createPublicClient({
    transport: http(rpcUrl, {
      fetchFn: netguard.fetchFor('history'),
      retryCount: 0,
      timeout: 30_000,
    }),
  })
  return {
    latestBlock: () => client.getBlockNumber({ cacheTime: 0 }),
    finalizedBlock: () =>
      client
        .getBlock({ blockTag: 'finalized' })
        .then((b) => b.number ?? undefined)
        .catch(() => undefined),
    getLogs: ({ address, fromBlock, toBlock }) => client.getLogs({ address, fromBlock, toBlock }),
    nonce: (safe: Address) =>
      client.readContract({ address: safe, abi: nonceAbi, functionName: 'nonce' }),
    blockTimestamp: (blockNumber) => client.getBlock({ blockNumber }).then((b) => b.timestamp),
  }
}

async function start(target: ScanTarget) {
  const key = historyKey(target.chainId, target.safe)
  const onProgress = (progress: ScanProgress) => {
    post({ type: 'progress', progress })
    channel?.postMessage({ key, progress } satisfies Broadcast)
  }
  const scan = async () => {
    const progress = await Effect.runPromise(
      scanHistory(clientFor(target.rpcUrl), target, onProgress).pipe(Effect.provide(StorageLive)),
    )
    onProgress(progress)
    post({ type: 'done' })
  }
  // One scanner per Safe across tabs; the others follow along on the BroadcastChannel
  if (navigator.locks) {
    await navigator.locks.request(lockName(key), { ifAvailable: true }, async (lock) => {
      if (!lock) post({ type: 'busy' })
      else await scan()
    })
  } else {
    await scan()
  }
}

self.onmessage = ({ data: m }: MessageEvent<ToWorker>) => {
  netguard.setPolicy(m.policy)
  start(m.target).catch((e: unknown) =>
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
  )
}

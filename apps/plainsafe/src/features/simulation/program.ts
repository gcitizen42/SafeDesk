// The simulation fallback levels (SPEC §7.5): level 1 (eth_simulateV1) when the RPC supports it,
// else level 2 (simulateAndRevert), else a warning. Everything runs over the user's RPC.
import { Effect, Either } from 'effect'
import { type Address, type Hex, keccak256, type PublicClient } from 'viem'
import { deployments, findSimulateTxAccessor } from '@/core/deployments'
import { revertData } from '@/core/execution'
import { causes, classifyMethodError, errorInfo, shortMessage } from '@/core/rpc-errors'
import type { SafeTx } from '@/core/safe-tx'
import {
  type BalanceChange,
  balanceChanges,
  describeEvents,
  level1Outcome,
  level1Request,
  level2Data,
  level2Outcome,
  queuePath,
  queueSimulationRequest,
  type SimEvent,
} from '@/core/simulation'
import { SimulationReverted, SimulationUnavailable } from '@/effect/errors'
import { endpointOf, RPC_RETRY, Rpc, rpcCall } from '@/effect/rpc'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { NetguardBlockedError } from '@/netguard/guard'
import type { ChainSettings } from '@/schemas/settings'

export type SimulationResult =
  | {
      readonly level: 1
      readonly block: bigint
      readonly gasUsed: bigint
      readonly changes: readonly BalanceChange[]
      readonly events: readonly SimEvent[]
    }
  | {
      readonly level: 2
      readonly block: bigint
      readonly gasUsed: bigint
      /** Why level 1 didn't run. */
      readonly level1: string
    }

// What each RPC supports, remembered for the session (SPEC §7.5). "Temporary" isn't remembered.
const support = new Map<string, 'supported' | 'unsupported'>()
const supportKey = (rpc: ChainSettings['rpc'], chainId: number) =>
  rpc._tag === 'url' ? rpc.url : `wallet:${chainId}`
export function rememberSimulationSupport(
  rpc: ChainSettings['rpc'],
  chainId: number,
  status: 'supported' | 'unsupported' | 'temporary',
) {
  if (status !== 'temporary') support.set(supportKey(rpc, chainId), status)
}

const blocked = (e: unknown) => causes(e).some((c) => c instanceof NetguardBlockedError)
const temporary = (e: unknown) => !blocked(e) && classifyMethodError(errorInfo(e)) === 'temporary'

const level1 = (client: PublicClient, safe: SafeSnapshot, tx: SafeTx, owner: Address, hash: Hex) =>
  Effect.gen(function* () {
    const req = level1Request(safe.address, tx, owner)
    const [block] = yield* Effect.tryPromise({
      try: () =>
        client.simulateBlocks({
          blockNumber: safe.block,
          traceTransfers: true,
          validation: false,
          blocks: [{ calls: [req.call], stateOverrides: req.stateOverrides }],
        }),
      catch: (e) => e,
    }).pipe(Effect.retry({ ...RPC_RETRY, while: temporary }))
    const call = block?.calls[0]
    if (!call) return yield* Effect.fail(new Error('eth_simulateV1 returned no result'))
    return { call, outcome: level1Outcome(call, safe.address, hash) }
  })

/** A SimulateTxAccessor on this chain whose code matches safe-deployments (SPEC §4.2). */
const findAccessor = (
  client: PublicClient,
  endpoint: string,
  safe: SafeSnapshot,
  version?: string,
) =>
  Effect.gen(function* () {
    const candidates = [
      ...new Set(
        [...deployments.simulateTxAccessor]
          .sort((a, b) => Number(b.version === version) - Number(a.version === version))
          .map((a) => a.address),
      ),
    ]
    const codes = yield* Effect.forEach(
      candidates,
      (address) =>
        rpcCall(endpoint, () => client.getCode({ address, blockNumber: safe.block })).pipe(
          Effect.map((code) => ({ address, code })),
        ),
      { concurrency: 'unbounded' },
    )
    return codes.find(
      ({ address, code }) =>
        code &&
        code !== '0x' &&
        findSimulateTxAccessor(keccak256(code))?.address.toLowerCase() === address.toLowerCase(),
    )?.address
  })

const level2 = (
  client: PublicClient,
  endpoint: string,
  safe: SafeSnapshot,
  tx: SafeTx,
  version?: string,
) =>
  Effect.gen(function* () {
    const accessor = yield* findAccessor(client, endpoint, safe, version)
    if (!accessor)
      return yield* new SimulationUnavailable({
        reason: 'No verified SimulateTxAccessor is deployed on this chain.',
      })
    // simulateAndRevert always reverts, and the revert data is the answer. Other failures are
    // the RPC's, so retry those that look temporary.
    const reverted = yield* Effect.tryPromise({
      try: () =>
        client.call({ to: safe.address, data: level2Data(accessor, tx), blockNumber: safe.block }),
      catch: (e) => e,
    }).pipe(
      Effect.as<unknown>(undefined),
      Effect.catchIf(
        (e) => revertData(e) !== undefined,
        (e) => Effect.succeed(e),
      ),
      Effect.retry({ ...RPC_RETRY, while: temporary }),
      Effect.mapError(
        (e) => new SimulationUnavailable({ reason: `The RPC call failed: ${shortMessage(e)}` }),
      ),
    )
    const outcome = level2Outcome(revertData(reverted))
    if (!outcome)
      return yield* new SimulationUnavailable({
        reason: `The Safe's simulateAndRevert gave an unexpected answer: ${shortMessage(reverted)}`,
      })
    return outcome
  })

export const simulate = (chainId: number, safe: SafeSnapshot, tx: SafeTx, safeTxHash: Hex) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const chain = yield* rpc.chain(chainId)
    const client = yield* rpc.client(chainId, 'simulation')
    const endpoint = endpointOf(chain)
    const key = supportKey(chain.rpc, chainId)
    const version = safe.authenticity.status === 'verified' ? safe.authenticity.version : undefined
    const owner = safe.owners?.[0]

    let why = "Your RPC doesn't support eth_simulateV1."
    if (owner && support.get(key) !== 'unsupported') {
      const r = yield* Effect.either(level1(client, safe, tx, owner, safeTxHash))
      if (Either.isRight(r)) {
        support.set(key, 'supported')
        const { call, outcome } = r.right
        if (!outcome.ok)
          return yield* new SimulationReverted({
            level: 1,
            block: safe.block,
            reason: outcome.reason,
            gasUsed: outcome.gasUsed,
          })
        const logs = call.logs ?? []
        return {
          level: 1,
          block: safe.block,
          gasUsed: outcome.gasUsed,
          changes: balanceChanges(logs, safe.address),
          events: describeEvents(logs),
        } satisfies SimulationResult
      }
      const e = r.left
      if (blocked(e)) why = 'eth_simulateV1 was blocked by netguard.'
      else if (temporary(e))
        why = `eth_simulateV1 failed for now (${shortMessage(e)}), so this used level 2.`
      else support.set(key, 'unsupported')
    }
    const outcome = yield* level2(client, endpoint, safe, tx, version)
    if (!outcome.ok)
      return yield* new SimulationReverted({
        level: 2,
        block: safe.block,
        reason: outcome.reason,
        gasUsed: outcome.gasUsed,
      })
    return {
      level: 2,
      block: safe.block,
      gasUsed: outcome.gasUsed,
      level1: why,
    } satisfies SimulationResult
  })

export type QueueSimOutcome =
  | { readonly status: 'ok' }
  | { readonly status: 'fails'; readonly reason: string }
  /** An earlier transaction in the path reverts, so this nonce wouldn't be reached. */
  | { readonly status: 'blocked'; readonly nonce: bigint }

/**
 * Simulate the queue in one eth_simulateV1 call (P1): nonce N, N+1, … while each nonce has
 * exactly one queued transaction. Level 1 only; the result is keyed by safeTxHash.
 */
export const simulateQueue = (
  chainId: number,
  safe: SafeSnapshot,
  items: readonly { readonly tx: SafeTx; readonly safeTxHash: Hex }[],
) =>
  Effect.gen(function* () {
    const outcomes = new Map<Hex, QueueSimOutcome>()
    if (safe.nonce === undefined) return outcomes
    const path = queuePath(items, safe.nonce)
    const owner = safe.owners?.[0]
    const req = owner
      ? queueSimulationRequest(
          safe.address,
          path.map((p) => p.tx),
          owner,
        )
      : undefined
    if (!req) return outcomes
    const rpc = yield* Rpc
    const chain = yield* rpc.chain(chainId)
    const key = supportKey(chain.rpc, chainId)
    if (support.get(key) === 'unsupported')
      return yield* new SimulationUnavailable({
        reason: "Your RPC doesn't support eth_simulateV1.",
      })
    const client = yield* rpc.client(chainId, 'simulation')
    const [block] = yield* Effect.tryPromise({
      try: () =>
        client.simulateBlocks({
          blockNumber: safe.block,
          validation: false,
          blocks: [{ calls: req.calls, stateOverrides: req.stateOverrides }],
        }),
      catch: (e) => e,
    }).pipe(
      Effect.retry({ ...RPC_RETRY, while: temporary }),
      Effect.tapError((e) =>
        Effect.sync(() => {
          if (!blocked(e) && !temporary(e)) support.set(key, 'unsupported')
        }),
      ),
      Effect.mapError(
        (e) => new SimulationUnavailable({ reason: `eth_simulateV1 failed: ${shortMessage(e)}` }),
      ),
    )
    support.set(key, 'supported')
    let revertedAt: bigint | undefined
    path.forEach((item, i) => {
      if (revertedAt !== undefined) {
        outcomes.set(item.safeTxHash, { status: 'blocked', nonce: revertedAt })
        return
      }
      const call = block?.calls[i]
      if (!call) return
      const o = level1Outcome(call, safe.address, item.safeTxHash)
      outcomes.set(item.safeTxHash, o.ok ? { status: 'ok' } : { status: 'fails', reason: o.reason })
      // A revert leaves the nonce where it was; an ExecutionFailure still uses it up.
      if (call.status === 'failure') revertedAt = item.tx.nonce
    })
    return outcomes
  })

// The setup screen's Test (SPEC §3.1): eth_chainId must match, then probe eth_simulateV1 (§7.5).
import { Effect } from 'effect'
import { zeroAddress } from 'viem'
import { classifyMethodError, errorInfo, shortMessage } from '@/core/rpc-errors'
import { RPC_RETRY, rpcCall } from '@/effect/rpc'
import { type Endpoint, endpointLabel, publicClientFor } from '@/effect/rpc-client'
import { rememberSimulationSupport } from '@/features/simulation/program'

type SimulationSupport =
  | { readonly status: 'supported' }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'temporary'; readonly reason: string }

export interface RpcTestResult {
  readonly chainId: number
  readonly simulation: SimulationSupport
}

/** The caller compares `chainId` with the chain it expects, so results can be cached per URL. */
export const testRpc = (endpoint: Endpoint) =>
  Effect.gen(function* () {
    const client = publicClientFor(endpoint, 'setup:test')
    const chainId = yield* rpcCall(endpointLabel(endpoint), () => client.getChainId())
    const simulation = yield* probeSimulation(endpoint)
    // Reused by simulations later this session (SPEC §7.5)
    rememberSimulationSupport(
      endpoint.kind === 'url' ? { _tag: 'url', url: endpoint.url } : { _tag: 'wallet' },
      chainId,
      simulation.status,
    )
    return { chainId, simulation } satisfies RpcTestResult
  })

/** A trivial eth_simulateV1 call. Odd errors count as temporary, never as "unsupported". */
const probeSimulation = (endpoint: Endpoint) =>
  Effect.tryPromise(() =>
    publicClientFor(endpoint, 'setup:simulate-probe').simulateBlocks({
      blocks: [{ calls: [{ to: zeroAddress, data: '0x' }] }],
    }),
  ).pipe(
    Effect.retry({
      ...RPC_RETRY,
      while: (e) => classifyMethodError(errorInfo(e.error)) === 'temporary',
    }),
    Effect.map((): SimulationSupport => ({ status: 'supported' })),
    Effect.catchTag('UnknownException', (e) =>
      Effect.succeed<SimulationSupport>({
        status: classifyMethodError(errorInfo(e.error)),
        reason: shortMessage(e.error),
      }),
    ),
  )

// SPEC §3.13: swaps built by the app, executed by a real Mainnet Safe through eth_simulateV1
// against Universal Router 2.2.0. Quotes come from the same candidate routes and quoter calls the
// app uses. Runs only when MAINNET_RPC_URL is set. State overrides only, no keys at all.
import {
  type Address,
  createPublicClient,
  erc20Abi,
  http,
  parseAbi,
  parseEther,
  parseEventLogs,
  zeroAddress,
} from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { deployments } from '@/core/deployments'
import { encodeMultiSend } from '@/core/multisend'
import type { SafeTx } from '@/core/safe-tx'
import { balanceChanges, NATIVE_PSEUDO_TOKEN, queueSimulationRequest } from '@/core/simulation'
import {
  bestQuote,
  candidateRoutes,
  ETH,
  meanTick,
  minimumOut,
  type Quote,
  quoteCall,
  type Route,
  type SwapIntent,
  shortfall,
  swapCalls,
  TWAP_SECONDS,
  twapOutput,
  twapPools,
  UNISWAP,
  v3PoolAbi,
} from '@/core/uniswap'

const RPC = process.env.MAINNET_RPC_URL
const SAFE: Address = '0x27e9f607817A05669D9C3794fb9Cd43724f61614' // v1.4.1
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const c = UNISWAP[1] as NonNullable<(typeof UNISWAP)[1]>
const safeAbi = parseAbi([
  'function getOwners() view returns (address[])',
  'function nonce() view returns (uint256)',
  'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
])
const multiSendCallOnly = deployments.multiSendCallOnly.find(
  (m) => m.version === '1.4.1' && m.variant === 'canonical',
)?.address as Address

const tx = (call: { to: Address; value: bigint; data: `0x${string}` }, nonce: bigint, op: 0 | 1) =>
  ({
    ...call,
    operation: op,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  }) satisfies SafeTx

describe.skipIf(!RPC)('swaps on Mainnet through Universal Router 2.2.0 (SPEC §3.13)', () => {
  const client = createPublicClient({ chain: mainnet, transport: http(RPC, { retryCount: 3 }) })

  const quotes = async (intent: SwapIntent, blockNumber: bigint) => {
    const routes = candidateRoutes(intent, c)
    const results = await client.multicall({
      contracts: routes.map((r) => quoteCall(r, intent.amountIn, c)),
      allowFailure: true,
      blockNumber,
      batchSize: 4096,
    })
    return routes.flatMap((route, i): Quote[] => {
      const r = results[i]
      return r?.status === 'success'
        ? [{ route, amountOut: (r.result as readonly [bigint, ...unknown[]])[0] }]
        : []
    })
  }
  const best = (qs: readonly Quote[], protocol: Route['protocol']) =>
    bestQuote(qs.filter((q) => q.route.protocol === protocol))

  it('buys and sells through v3 and v4, with approvals, as one queue of Safe transactions', async () => {
    const blockNumber = await client.getBlockNumber()
    const block = await client.getBlock({ blockNumber })
    const deadline = block.timestamp + 3600n
    const [owners, nonce] = await Promise.all([
      client.readContract({ address: SAFE, abi: safeAbi, functionName: 'getOwners', blockNumber }),
      client.readContract({ address: SAFE, abi: safeAbi, functionName: 'nonce', blockNumber }),
    ])

    // 1. ETH → USDC on v4 (a direct call: selling ETH needs no approvals)
    const buyUsdc: SwapIntent = { sell: ETH, buy: c.usdc, amountIn: parseEther('1') }
    const q1 = best(await quotes(buyUsdc, blockNumber), 'v4')
    // 2. ETH → DAI on v3 (WRAP_ETH first)
    const buyDai: SwapIntent = { sell: ETH, buy: DAI, amountIn: parseEther('1') }
    const q2 = best(await quotes(buyDai, blockNumber), 'v3')
    // 3. USDC → ETH on v3 (UNWRAP_WETH last), through MultiSendCallOnly with both approvals
    const sellUsdc: SwapIntent = { sell: c.usdc, buy: ETH, amountIn: 500_000_000n }
    const q3 = best(await quotes(sellUsdc, blockNumber), 'v3')
    // 4. DAI → USDC on v4 (Permit2 pulls DAI into the PoolManager)
    const sellDai: SwapIntent = { sell: DAI, buy: c.usdc, amountIn: parseEther('500') }
    const q4 = best(await quotes(sellDai, blockNumber), 'v4')
    if (!q1 || !q2 || !q3 || !q4) throw new Error('no quote')

    const plan = (intent: SwapIntent, q: Quote) => ({
      intent,
      route: q.route,
      minOut: minimumOut(q.amountOut, 100),
      recipient: SAFE,
      deadline,
    })
    const batch = (calls: ReturnType<typeof swapCalls>, n: bigint) =>
      calls.length === 1 && calls[0]
        ? tx(calls[0], n, 0)
        : tx({ to: multiSendCallOnly, value: 0n, data: encodeMultiSend(calls) }, n, 1)
    // Allowances to Permit2 are read at the pinned block, like the app does
    const allowance = (token: Address) =>
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [SAFE, c.permit2],
        blockNumber,
      })
    const plans = [plan(buyUsdc, q1), plan(buyDai, q2), plan(sellUsdc, q3), plan(sellDai, q4)]
    const txs = [
      batch(swapCalls(plan(buyUsdc, q1), c, 0n), nonce),
      batch(swapCalls(plan(buyDai, q2), c, 0n), nonce + 1n),
      batch(swapCalls(plan(sellUsdc, q3), c, await allowance(c.usdc)), nonce + 2n),
      batch(swapCalls(plan(sellDai, q4), c, await allowance(DAI)), nonce + 3n),
    ]
    const req = queueSimulationRequest(SAFE, txs, owners[0] as Address)
    if (!req) throw new Error('no request')
    const [override] = req.stateOverrides
    const [result] = await client.simulateBlocks({
      blockNumber,
      traceTransfers: true,
      validation: false,
      blocks: [
        {
          calls: req.calls,
          stateOverrides: [{ ...override, address: SAFE, balance: parseEther('5') }],
        },
      ],
    })
    const calls = result?.calls ?? []
    expect(calls).toHaveLength(4)
    for (const [i, call] of calls.entries()) {
      expect(call.status, `swap ${i + 1}: ${call.error?.message}`).toBe('success')
      const ok = parseEventLogs({
        abi: safeAbi,
        logs: call.logs ?? [],
        eventName: 'ExecutionSuccess',
      })
      expect(ok).toHaveLength(1)
      // The Safe paid exactly the amount in and got at least the signed minimum back
      const p = plans[i]
      if (!p) throw new Error('no plan')
      const delta = (token: Address) =>
        balanceChanges(call.logs ?? [], SAFE).reduce((sum, b) => {
          const t = b.kind === 'native' ? NATIVE_PSEUDO_TOKEN : b.token
          const want = token === ETH ? NATIVE_PSEUDO_TOKEN : token
          return t.toLowerCase() === want.toLowerCase() ? sum + b.delta : sum
        }, 0n)
      expect(delta(p.intent.sell)).toBe(-p.intent.amountIn)
      expect(delta(p.intent.buy)).toBeGreaterThanOrEqual(p.minOut)
    }
  })

  it('reads a 30-minute TWAP for the best v3 route and finds the quote close to it', async () => {
    const blockNumber = await client.getBlockNumber()
    const intent: SwapIntent = { sell: ETH, buy: c.usdc, amountIn: parseEther('1') }
    const q = best(await quotes(intent, blockNumber), 'v3')
    if (!q) throw new Error('no quote')
    const hops = twapPools(q.route, c)
    const obs = await client.multicall({
      contracts: hops.map((h) => ({
        address: h.pool,
        abi: v3PoolAbi,
        functionName: 'observe' as const,
        args: [[TWAP_SECONDS, 0]] as const,
      })),
      blockNumber,
      allowFailure: false,
    })
    const expected = twapOutput(
      intent.amountIn,
      hops.map((h, i) => {
        const ticks = obs[i]?.[0] ?? []
        return { ...h, tick: meanTick([ticks[0] ?? 0n, ticks[1] ?? 0n]) }
      }),
    )
    // A deep pool over 30 minutes: well within the 2% warning band either way
    expect(Math.abs(shortfall(q.amountOut, expected))).toBeLessThan(0.02)
  })
})

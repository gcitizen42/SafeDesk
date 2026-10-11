import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { permit2Abi } from './known-abis'
import { encodeMultiSend } from './multisend'
import {
  ADDRESS_THIS,
  bestQuote,
  candidateRoutes,
  decodeRouterCall,
  decodeV3Path,
  ETH,
  encodeSwap,
  encodeV3Path,
  meanTick,
  minimumOut,
  type Route,
  type SwapPlan,
  shortfall,
  summarizeSwap,
  swapCalls,
  swapInTx,
  twapOutput,
  twapPools,
  UNISWAP,
  universalRouterAbi,
  v3PoolAddress,
} from './uniswap'

const c = UNISWAP[1] as NonNullable<(typeof UNISWAP)[1]>
const SAFE = '0x1111111111111111111111111111111111111111'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const deadline = 1_900_000_000n

const plan = (p: Partial<SwapPlan> & Pick<SwapPlan, 'route'>): SwapPlan => ({
  intent: { sell: c.usdc, buy: DAI, amountIn: 1_000_000n },
  minOut: 990_000_000_000_000_000n,
  recipient: SAFE,
  deadline,
  ...p,
})

describe('routes', () => {
  it('builds direct and two-hop candidates on v3 and v4, skipping hops through an end token', () => {
    const r = candidateRoutes({ sell: ETH, buy: c.usdc, amountIn: 1n }, c)
    // v3: WETH→USDC direct (4); via WETH and via USDC are skipped: both are end tokens
    // v4: ETH→USDC direct (4); via ETH and via USDC skipped
    expect(r.filter((x) => x.protocol === 'v3')).toHaveLength(4)
    expect(r.filter((x) => x.protocol === 'v4')).toHaveLength(4)
    expect(r.find((x) => x.protocol === 'v3')?.path[0]).toBe(c.weth)
    expect(r.find((x) => x.protocol === 'v4')?.path[0]).toBe(ETH)
    const dai = candidateRoutes({ sell: DAI, buy: c.usdc, amountIn: 1n }, c)
    // direct 4 + via WETH (v3) or ETH (v4) 16, per protocol
    expect(dai).toHaveLength(2 * (4 + 16))
  })

  it('offers nothing for ETH↔WETH, which is a wrap, not a swap', () => {
    expect(candidateRoutes({ sell: ETH, buy: c.weth, amountIn: 1n }, c)).toEqual([])
  })

  it('round-trips v3 paths', () => {
    const r: Route = { protocol: 'v3', path: [c.usdc, c.weth, DAI], fees: [500, 3000] }
    expect(decodeV3Path(encodeV3Path(r))).toEqual(r)
    expect(decodeV3Path('0x1234')).toBeUndefined()
  })

  it('picks the best output, preferring the shorter route on a tie', () => {
    const a: Route = { protocol: 'v3', path: [c.usdc, DAI], fees: [100] }
    const b: Route = { protocol: 'v4', path: [c.usdc, ETH, DAI], fees: [500, 500] }
    expect(
      bestQuote([
        { route: b, amountOut: 5n },
        { route: a, amountOut: 5n },
      ])?.route,
    ).toBe(a)
    expect(
      bestQuote([
        { route: a, amountOut: 4n },
        { route: b, amountOut: 5n },
      ])?.route,
    ).toBe(b)
    expect(bestQuote([{ route: a, amountOut: 0n }])).toBeUndefined()
  })

  it('computes the minimum from the slippage', () => {
    expect(minimumOut(1_000_000n, 100)).toBe(990_000n)
    expect(minimumOut(1_000_000n, 0)).toBe(1_000_000n)
  })
})

describe('Universal Router 2.2.0 encoding', () => {
  it('encodes a v3 token swap with the Safe as recipient and an empty per-hop list', () => {
    const route: Route = { protocol: 'v3', path: [c.usdc, c.weth, DAI], fees: [500, 3000] }
    const call = encodeSwap(plan({ route }), c)
    expect(call.to).toBe(c.universalRouter)
    expect(call.value).toBe(0n)
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data: call.data })
    expect(args[0]).toBe('0x00')
    // abi.decode(inputs, (address, uint256, uint256, bytes, bool, uint256[]))
    expect(args[1][0]).toBe(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'bytes' },
          { type: 'bool' },
          { type: 'uint256[]' },
        ],
        [SAFE, 1_000_000n, 990_000_000_000_000_000n, encodeV3Path(route), true, []],
      ),
    )
    expect(args[2]).toBe(deadline)
  })

  it('wraps ETH first when selling ETH on v3, and unwraps to the Safe when buying it', () => {
    const sell = encodeSwap(
      plan({
        intent: { sell: ETH, buy: c.usdc, amountIn: 10n ** 18n },
        route: { protocol: 'v3', path: [c.weth, c.usdc], fees: [500] },
      }),
      c,
    )
    expect(sell.value).toBe(10n ** 18n)
    const s = decodeRouterCall(sell.data)
    expect(s?.commands.map((x) => x.kind)).toEqual(['wrap-eth', 'v3-swap-exact-in'])
    const buy = decodeRouterCall(
      encodeSwap(
        plan({
          intent: { sell: c.usdc, buy: ETH, amountIn: 1_000_000n },
          route: { protocol: 'v3', path: [c.usdc, c.weth], fees: [500] },
          minOut: 5n,
        }),
        c,
      ).data,
    )
    expect(buy?.commands).toMatchObject([
      { kind: 'v3-swap-exact-in', recipient: ADDRESS_THIS, payerIsUser: true },
      { kind: 'unwrap-weth', recipient: SAFE, amountMin: 5n },
    ])
  })

  it('encodes v4 as SWAP_EXACT_IN, SETTLE_ALL, TAKE_ALL', () => {
    const route: Route = { protocol: 'v4', path: [ETH, c.usdc], fees: [500] }
    const call = encodeSwap(
      plan({ intent: { sell: ETH, buy: c.usdc, amountIn: 7n }, route, minOut: 3n }),
      c,
    )
    expect(call.value).toBe(7n)
    const d = decodeRouterCall(call.data)
    expect(d?.commands).toEqual([
      {
        kind: 'v4-swap',
        actions: [
          { kind: 'swap-exact-in', route, amountIn: 7n, amountOutMinimum: 3n, standardPools: true },
          { kind: 'settle-all', currency: ETH, maxAmount: 7n },
          { kind: 'take-all', currency: c.usdc, minAmount: 3n },
        ],
      },
    ])
  })

  it('summarizes every shape it builds, and nothing else', () => {
    const shapes: SwapPlan[] = [
      plan({ route: { protocol: 'v3', path: [c.usdc, c.weth, DAI], fees: [500, 3000] } }),
      plan({
        intent: { sell: ETH, buy: DAI, amountIn: 9n },
        route: { protocol: 'v3', path: [c.weth, DAI], fees: [3000] },
      }),
      plan({
        intent: { sell: DAI, buy: ETH, amountIn: 9n },
        route: { protocol: 'v3', path: [DAI, c.weth], fees: [3000] },
      }),
      plan({
        intent: { sell: c.usdc, buy: ETH, amountIn: 9n },
        route: { protocol: 'v4', path: [c.usdc, ETH], fees: [500] },
      }),
      plan({ route: { protocol: 'v4', path: [c.usdc, ETH, DAI], fees: [500, 3000] } }),
    ]
    for (const p of shapes) {
      const d = decodeRouterCall(encodeSwap(p, c).data)
      expect(d && summarizeSwap(d, SAFE, c)).toEqual({
        route: p.route,
        sell: p.intent.sell,
        amountIn: p.intent.amountIn,
        buy: p.intent.buy,
        minOut: p.minOut,
        deadline,
      })
      // v3 names the recipient: for another Safe, the output wouldn't reach it. v4's TAKE_ALL
      // always pays the caller, which is whichever Safe executes it.
      if (p.route.protocol === 'v3') expect(d && summarizeSwap(d, DAI, c)).toBeUndefined()
    }
  })

  it('rejects malformed calldata', () => {
    expect(decodeRouterCall('0x3593564c')).toBeUndefined()
    const mismatched = encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: ['0x0000', ['0x'], 1n],
    })
    expect(decodeRouterCall(mismatched)).toBeUndefined()
  })

  it('keeps unknown commands visible instead of dropping them', () => {
    const data = encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: ['0x05', ['0x' as Hex], 1n],
    })
    expect(decodeRouterCall(data)?.commands).toEqual([{ kind: 'other', command: 5 }])
  })
})

describe('the swap batch', () => {
  const route: Route = { protocol: 'v3', path: [c.usdc, DAI], fees: [100] }
  const p = plan({ route })

  it('approves Permit2 only when the allowance is too low, resetting a nonzero one first', () => {
    const kinds = (allowance: bigint) =>
      swapCalls(p, c, allowance).map((x) =>
        x.to === c.usdc
          ? `approve ${decodeFunctionData({ abi: erc20Abi, data: x.data }).args[1]}`
          : x.to === c.permit2
            ? 'permit2'
            : 'swap',
      )
    expect(kinds(0n)).toEqual(['approve 1000000', 'permit2', 'swap'])
    expect(kinds(5n)).toEqual(['approve 0', 'approve 1000000', 'permit2', 'swap'])
    expect(kinds(1_000_000n)).toEqual(['permit2', 'swap'])
  })

  it('lets the router spend exactly the amount until the deadline', () => {
    const permit = swapCalls(p, c, 10n ** 30n)[0]
    expect(decodeFunctionData({ abi: permit2Abi, data: permit?.data ?? '0x' }).args).toEqual([
      c.usdc,
      c.universalRouter,
      1_000_000n,
      Number(deadline),
    ])
  })

  it('needs no approvals to sell ETH', () => {
    const calls = swapCalls(
      plan({
        intent: { sell: ETH, buy: DAI, amountIn: 1n },
        route: { protocol: 'v4', path: [ETH, DAI], fees: [3000] },
      }),
      c,
      0n,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.to).toBe(c.universalRouter)
  })
})

describe('TWAP', () => {
  it('computes known v3 pool addresses', () => {
    // USDC/WETH 0.05% and 0.3% on Mainnet
    expect(v3PoolAddress(c.v3Factory, c.weth, c.usdc, 500)).toBe(
      '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    )
    expect(v3PoolAddress(c.v3Factory, c.usdc, c.weth, 3000)).toBe(
      '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
    )
  })

  it('maps v4 hops to the v3 pool of the same pair, with ETH as WETH', () => {
    const [hop] = twapPools({ protocol: 'v4', path: [ETH, c.usdc], fees: [500] }, c)
    expect(hop?.pool).toBe('0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640')
    expect(hop?.tokenIn).toBe(c.weth)
  })

  it('rounds the mean tick toward negative infinity', () => {
    expect(meanTick([0n, 1800n * 7n])).toBe(7)
    expect(meanTick([0n, -1800n * 7n - 1n])).toBe(-8)
    expect(meanTick([100n, 100n])).toBe(0)
  })

  it('turns ticks into an expected output after fees', () => {
    const a = '0x0000000000000000000000000000000000000001'
    const b = '0x0000000000000000000000000000000000000002'
    // tick 0: price 1; a 0.3% fee leaves 99.7%
    expect(twapOutput(1_000_000n, [{ tick: 0, tokenIn: a, tokenOut: b, fee: 3000 }])).toBeCloseTo(
      997_000,
    )
    // Selling token1 for token0 inverts the price
    const up = twapOutput(1_000_000n, [{ tick: 6932, tokenIn: a, tokenOut: b, fee: 0 }])
    const down = twapOutput(1_000_000n, [{ tick: 6932, tokenIn: b, tokenOut: a, fee: 0 }])
    expect(up / 1_000_000).toBeCloseTo(2, 2)
    expect(down / 1_000_000).toBeCloseTo(0.5, 2)
    expect(shortfall(97n, 100)).toBeCloseTo(0.03)
    expect(shortfall(101n, 100)).toBeLessThan(0)
  })
})

describe('finding the swap in a Safe transaction', () => {
  const route: Route = { protocol: 'v3', path: [c.usdc, DAI], fees: [100] }
  const p = plan({ route })
  const MULTISEND = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'

  it('finds a direct router call and the router call inside a batch', () => {
    const [swap] = swapCalls(
      plan({
        ...p,
        intent: { ...p.intent, sell: ETH },
        route: { protocol: 'v4', path: [ETH, DAI], fees: [500] },
      }),
      c,
      0n,
    )
    if (!swap) throw new Error('no call')
    expect(swapInTx({ ...swap, operation: 0 }, SAFE, c)?.sell).toBe(ETH)
    const batch = {
      to: MULTISEND,
      data: encodeMultiSend(swapCalls(p, c, 0n)),
      operation: 1,
    } as const
    expect(swapInTx(batch, SAFE, c)).toMatchObject({ sell: c.usdc, buy: DAI, amountIn: 1_000_000n })
  })

  it('ignores anything else', () => {
    expect(swapInTx({ to: DAI, data: '0x', operation: 0 }, SAFE, c)).toBeUndefined()
    // A router call by delegatecall is never a swap the app built
    const [swap] = swapCalls(p, c, 10n ** 30n).slice(-1)
    if (!swap) throw new Error('no call')
    expect(swapInTx({ ...swap, operation: 1 }, SAFE, c)).toBeUndefined()
    // Two router calls in one batch: not one of our shapes
    const two = encodeMultiSend([swap, swap])
    expect(swapInTx({ to: MULTISEND, data: two, operation: 1 }, SAFE, c)).toBeUndefined()
  })
})

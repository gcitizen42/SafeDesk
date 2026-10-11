// Swap through Uniswap (SPEC §3.13, P1): the pure parts. Contract addresses, candidate routes,
// quoter calls, Universal Router 2.2.0 encoding and decoding, the swap batch, and the TWAP
// arithmetic. Layouts follow the router's source at universal-router@2.2.0 (Dispatcher.sol) and
// the v4-periphery commit it pins (IV4Router.sol, Actions.sol, CalldataDecoder.sol).
import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  getContractAddress,
  type Hex,
  hexToNumber,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  size,
  slice,
  zeroAddress,
} from 'viem'
import { sameAddress } from '@/lib/format'
import { type Decoded, decodeCalldata } from './decode'
import { permit2Abi } from './known-abis'
import { type BatchCall, decodeMultiSend } from './multisend'
import type { SafeTx } from './safe-tx'

// ---------- contracts ----------

export interface UniswapContracts {
  /** Universal Router 2.2.0: the most recently deployed version on both chains (2026-09-18). */
  readonly universalRouter: Address
  readonly permit2: Address
  readonly quoterV2: Address
  readonly v4Quoter: Address
  readonly v3Factory: Address
  readonly weth: Address
  readonly usdc: Address
}

/** From Uniswap's deployments.json (commit 3793618) and deployment docs (SPEC §3.13). */
export const UNISWAP: Readonly<Record<number, UniswapContracts>> = {
  1: {
    universalRouter: '0xab863E752Bf67D8DCDD929EaAe9Be9dc83Fb3BbB',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    v4Quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
    v3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  11155111: {
    universalRouter: '0x5093f1CDED83d99FfEd6602dA6260672ae16787c',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    quoterV2: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
    v4Quoter: '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227',
    v3Factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
    weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
}

/** Native ETH, as v4 and the router spell it. */
export const ETH: Address = zeroAddress
export const isEth = (a: Address) => a.toLowerCase() === ETH

// ---------- routes ----------

const V3_FEES = [100, 500, 3000, 10000] as const
/** Hookless v4 pools with the standard (fee, tickSpacing) pairs. */
const V4_TICK_SPACING: Readonly<Record<number, number>> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
}

/**
 * A route: `path` has one more entry than `fees`. v3 paths are ERC-20s (ETH is WETH); v4 paths
 * use `ETH` (address 0) for native ETH, and pools are hookless.
 */
export interface Route {
  readonly protocol: 'v3' | 'v4'
  readonly path: readonly Address[]
  readonly fees: readonly number[]
}

/** The token a route sells and the token it buys. */
const endsOf = (r: Route): readonly [Address, Address] => [r.path[0], r.path[r.path.length - 1]]

export interface SwapIntent {
  /** `ETH` for native ETH. */
  readonly sell: Address
  readonly buy: Address
  readonly amountIn: bigint
}

/** Direct routes plus two-hop routes through WETH (v4: native ETH) and USDC, on v3 and v4. */
export function candidateRoutes(intent: SwapIntent, c: UniswapContracts): Route[] {
  const routes: Route[] = []
  const add = (protocol: Route['protocol'], a: Address, b: Address, via: readonly Address[]) => {
    if (sameAddress(a, b)) return
    for (const fee of V3_FEES) routes.push({ protocol, path: [a, b], fees: [fee] })
    for (const x of via) {
      if (sameAddress(x, a) || sameAddress(x, b)) continue
      for (const f1 of V3_FEES)
        for (const f2 of V3_FEES) routes.push({ protocol, path: [a, x, b], fees: [f1, f2] })
    }
  }
  const wrap = (t: Address) => (isEth(t) ? c.weth : t)
  add('v3', wrap(intent.sell), wrap(intent.buy), [c.weth, c.usdc])
  // v4 treats WETH and ETH as different currencies; ETH↔WETH is a wrap, not a swap.
  if (!(sameAddress(wrap(intent.sell), wrap(intent.buy)) && !sameAddress(intent.sell, intent.buy)))
    add('v4', intent.sell, intent.buy, [ETH, c.usdc])
  return routes
}

export const encodeV3Path = (r: Route): Hex =>
  concat(
    r.path.flatMap((t, i) => (i < r.fees.length ? [t, numberToUint24(r.fees[i] ?? 0)] : [t])),
  ).toLowerCase() as Hex

const numberToUint24 = (n: number): Hex => encodePacked(['uint24'], [n])

export function decodeV3Path(path: Hex): Route | undefined {
  const n = size(path)
  if (n < 43 || (n - 20) % 23 !== 0) return undefined
  const tokens: Address[] = []
  const fees: number[] = []
  for (let at = 0; ; at += 23) {
    tokens.push(getAddress(slice(path, at, at + 20)))
    if (at + 20 === n) break
    fees.push(hexToNumber(slice(path, at + 20, at + 23)))
  }
  return { protocol: 'v3', path: tokens, fees }
}

interface PathKey {
  readonly intermediateCurrency: Address
  readonly fee: number
  readonly tickSpacing: number
  readonly hooks: Address
  readonly hookData: Hex
}

const v4PathKeys = (r: Route): PathKey[] =>
  r.path.slice(1).map((currency, i) => {
    const fee = r.fees[i] ?? 0
    return {
      intermediateCurrency: currency,
      fee,
      tickSpacing: V4_TICK_SPACING[fee] ?? 0,
      hooks: zeroAddress,
      hookData: '0x',
    }
  })

// ---------- quoting ----------

const quoterV2Abi = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
])

const v4QuoterAbi = parseAbi([
  'struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }',
  'struct QuoteExactParams { address exactCurrency; PathKey[] path; uint128 exactAmount; }',
  'function quoteExactInput(QuoteExactParams params) returns (uint256 amountOut, uint256 gasEstimate)',
])

/** The quoter call for a route (for viem's multicall). */
export function quoteCall(r: Route, amountIn: bigint, c: UniswapContracts) {
  return r.protocol === 'v3'
    ? ({
        address: c.quoterV2,
        abi: quoterV2Abi,
        functionName: 'quoteExactInput',
        args: [encodeV3Path(r), amountIn],
      } as const)
    : ({
        address: c.v4Quoter,
        abi: v4QuoterAbi,
        functionName: 'quoteExactInput',
        args: [{ exactCurrency: r.path[0] as Address, path: v4PathKeys(r), exactAmount: amountIn }],
      } as const)
}

export interface Quote {
  readonly route: Route
  readonly amountOut: bigint
}

/** The best output wins (SPEC §3.13); ties go to the shorter route, then to v3. */
export function bestQuote(quotes: readonly Quote[]): Quote | undefined {
  let best: Quote | undefined
  for (const q of quotes) {
    if (q.amountOut <= 0n) continue
    if (
      !best ||
      q.amountOut > best.amountOut ||
      (q.amountOut === best.amountOut && q.route.fees.length < best.route.fees.length)
    )
      best = q
  }
  return best
}

/** quote × (1 − slippage), with slippage in basis points. */
export const minimumOut = (quote: bigint, slippageBps: number) =>
  (quote * BigInt(10_000 - slippageBps)) / 10_000n

// ---------- Universal Router 2.2.0 ----------

export const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
])

const COMMAND = {
  V3_SWAP_EXACT_IN: 0x00,
  SWEEP: 0x04,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  V4_SWAP: 0x10,
} as const

const V4_ACTION = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SETTLE_ALL: 0x0c,
  TAKE_ALL: 0x0f,
} as const

/** The router's recipient placeholders (ActionConstants). */
export const MSG_SENDER: Address = '0x0000000000000000000000000000000000000001'
export const ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002'

const V3_EXACT_IN = parseAbiParameters('address, uint256, uint256, bytes, bool, uint256[]')
/** Before 2.2.0 there was no per-hop minimum price. */
const V3_EXACT_IN_OLD = parseAbiParameters('address, uint256, uint256, bytes, bool')
const ADDRESS_UINT = parseAbiParameters('address, uint256')
const SWEEP = parseAbiParameters('address, address, uint256')
const ACTIONS = parseAbiParameters('bytes, bytes[]')
const EXACT_IN = parseAbiParameters(
  '(address currencyIn, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint256[] minHopPriceX36, uint128 amountIn, uint128 amountOutMinimum)',
)
const EXACT_IN_SINGLE = parseAbiParameters(
  '((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)',
)

export interface SwapPlan {
  readonly intent: SwapIntent
  readonly route: Route
  readonly minOut: bigint
  /** The Safe: the swap's output always goes back to it. */
  readonly recipient: Address
  /** Unix seconds. */
  readonly deadline: bigint
}

/** UniversalRouter.execute for a swap: to, value and calldata. */
export function encodeSwap(plan: SwapPlan, c: UniswapContracts): BatchCall {
  const { intent, route, minOut, recipient, deadline } = plan
  const commands: number[] = []
  const inputs: Hex[] = []
  if (route.protocol === 'v3') {
    const sellEth = isEth(intent.sell)
    const buyEth = isEth(intent.buy)
    if (sellEth) {
      commands.push(COMMAND.WRAP_ETH)
      inputs.push(encodeAbiParameters(ADDRESS_UINT, [ADDRESS_THIS, intent.amountIn]))
    }
    commands.push(COMMAND.V3_SWAP_EXACT_IN)
    inputs.push(
      encodeAbiParameters(V3_EXACT_IN, [
        buyEth ? ADDRESS_THIS : recipient,
        intent.amountIn,
        minOut,
        encodeV3Path(route),
        // payerIsUser: Permit2 pulls from the Safe, unless the router holds the wrapped ETH
        !sellEth,
        [],
      ]),
    )
    if (buyEth) {
      commands.push(COMMAND.UNWRAP_WETH)
      inputs.push(encodeAbiParameters(ADDRESS_UINT, [recipient, minOut]))
    }
  } else {
    const [currencyIn, currencyOut] = endsOf(route)
    const actions = encodePacked(
      ['uint8', 'uint8', 'uint8'],
      [V4_ACTION.SWAP_EXACT_IN, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_ALL],
    )
    const params = [
      encodeAbiParameters(EXACT_IN, [
        {
          currencyIn,
          path: v4PathKeys(route),
          minHopPriceX36: [],
          amountIn: intent.amountIn,
          amountOutMinimum: minOut,
        },
      ]),
      encodeAbiParameters(ADDRESS_UINT, [currencyIn, intent.amountIn]),
      // TAKE_ALL pays msg.sender, which is the Safe
      encodeAbiParameters(ADDRESS_UINT, [currencyOut, minOut]),
    ]
    commands.push(COMMAND.V4_SWAP)
    inputs.push(encodeAbiParameters(ACTIONS, [actions, params]))
  }
  return {
    operation: 0,
    to: c.universalRouter,
    value: isEth(intent.sell) ? intent.amountIn : 0n,
    data: encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [concat(commands.map((n) => numberToHex(n, { size: 1 }))), inputs, deadline],
    }),
  }
}

/**
 * The calls a swap needs (SPEC §3.13): the token's approval of Permit2 only when it's too low,
 * Permit2's approval of the router until the deadline, then the swap. A token that already has
 * a nonzero but too-low allowance is first reset to zero, since some (USDT) refuse otherwise.
 */
export function swapCalls(
  plan: SwapPlan,
  c: UniswapContracts,
  tokenAllowanceToPermit2: bigint,
): BatchCall[] {
  const swap = encodeSwap(plan, c)
  if (isEth(plan.intent.sell)) return [swap]
  const token = plan.intent.sell
  const approve = (amount: bigint): BatchCall => ({
    operation: 0,
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [c.permit2, amount] }),
  })
  const calls: BatchCall[] = []
  if (tokenAllowanceToPermit2 < plan.intent.amountIn) {
    if (tokenAllowanceToPermit2 > 0n) calls.push(approve(0n))
    calls.push(approve(plan.intent.amountIn))
  }
  calls.push({
    operation: 0,
    to: c.permit2,
    value: 0n,
    data: encodeFunctionData({
      abi: permit2Abi,
      functionName: 'approve',
      args: [token, c.universalRouter, plan.intent.amountIn, Number(plan.deadline)],
    }),
  })
  calls.push(swap)
  return calls
}

// ---------- decoding (for review, and the fresh quote) ----------

export type V4Action =
  | {
      readonly kind: 'swap-exact-in'
      readonly route: Route
      readonly amountIn: bigint
      readonly amountOutMinimum: bigint
      /** False when a pool has hooks or a non-standard tick spacing. */
      readonly standardPools: boolean
    }
  | {
      readonly kind: 'swap-exact-in-single'
      readonly route: Route
      readonly amountIn: bigint
      readonly amountOutMinimum: bigint
      readonly standardPools: boolean
    }
  | { readonly kind: 'settle-all'; readonly currency: Address; readonly maxAmount: bigint }
  | { readonly kind: 'take-all'; readonly currency: Address; readonly minAmount: bigint }
  | { readonly kind: 'other'; readonly action: number }

export type RouterCommand =
  | {
      readonly kind: 'v3-swap-exact-in'
      readonly recipient: Address
      readonly amountIn: bigint
      readonly amountOutMin: bigint
      readonly route: Route
      readonly payerIsUser: boolean
    }
  | { readonly kind: 'wrap-eth'; readonly recipient: Address; readonly amount: bigint }
  | { readonly kind: 'unwrap-weth'; readonly recipient: Address; readonly amountMin: bigint }
  | {
      readonly kind: 'sweep'
      readonly token: Address
      readonly recipient: Address
      readonly amountMin: bigint
    }
  | { readonly kind: 'v4-swap'; readonly actions: readonly V4Action[] }
  | { readonly kind: 'other'; readonly command: number }

export interface RouterCall {
  readonly commands: readonly RouterCommand[]
  readonly deadline: bigint
}

const std = (fee: number, tickSpacing: number, hooks: Address) =>
  V4_TICK_SPACING[fee] === tickSpacing && sameAddress(hooks, zeroAddress)

function decodeV4(input: Hex): V4Action[] | undefined {
  const [actions, params] = decodeAbiParameters(ACTIONS, input)
  if (size(actions) !== params.length) return undefined
  return params.map((p, i): V4Action => {
    const action = hexToNumber(slice(actions, i, i + 1))
    switch (action) {
      case V4_ACTION.SWAP_EXACT_IN: {
        const [s] = decodeAbiParameters(EXACT_IN, p)
        return {
          kind: 'swap-exact-in',
          route: {
            protocol: 'v4',
            path: [
              getAddress(s.currencyIn),
              ...s.path.map((k) => getAddress(k.intermediateCurrency)),
            ],
            fees: s.path.map((k) => k.fee),
          },
          amountIn: s.amountIn,
          amountOutMinimum: s.amountOutMinimum,
          standardPools: s.path.every((k) => std(k.fee, k.tickSpacing, k.hooks)),
        }
      }
      case V4_ACTION.SWAP_EXACT_IN_SINGLE: {
        const [s] = decodeAbiParameters(EXACT_IN_SINGLE, p)
        const k = s.poolKey
        const [from, to] = s.zeroForOne ? [k.currency0, k.currency1] : [k.currency1, k.currency0]
        return {
          kind: 'swap-exact-in-single',
          route: { protocol: 'v4', path: [getAddress(from), getAddress(to)], fees: [k.fee] },
          amountIn: s.amountIn,
          amountOutMinimum: s.amountOutMinimum,
          standardPools: std(k.fee, k.tickSpacing, k.hooks),
        }
      }
      case V4_ACTION.SETTLE_ALL: {
        const [currency, maxAmount] = decodeAbiParameters(ADDRESS_UINT, p)
        return { kind: 'settle-all', currency: getAddress(currency), maxAmount }
      }
      case V4_ACTION.TAKE_ALL: {
        const [currency, minAmount] = decodeAbiParameters(ADDRESS_UINT, p)
        return { kind: 'take-all', currency: getAddress(currency), minAmount }
      }
      default:
        return { kind: 'other', action }
    }
  })
}

function decodeCommand(command: number, input: Hex): RouterCommand | undefined {
  // Bit 7 is "allow revert"; the type is the low 7 bits (Commands.sol)
  switch (command & 0x7f) {
    case COMMAND.V3_SWAP_EXACT_IN: {
      let v: readonly [Address, bigint, bigint, Hex, boolean, ...unknown[]]
      try {
        v = decodeAbiParameters(V3_EXACT_IN, input)
      } catch {
        v = decodeAbiParameters(V3_EXACT_IN_OLD, input)
      }
      const route = decodeV3Path(v[3])
      if (!route) return undefined
      return {
        kind: 'v3-swap-exact-in',
        recipient: getAddress(v[0]),
        amountIn: v[1],
        amountOutMin: v[2],
        route,
        payerIsUser: v[4],
      }
    }
    case COMMAND.WRAP_ETH: {
      const [recipient, amount] = decodeAbiParameters(ADDRESS_UINT, input)
      return { kind: 'wrap-eth', recipient: getAddress(recipient), amount }
    }
    case COMMAND.UNWRAP_WETH: {
      const [recipient, amountMin] = decodeAbiParameters(ADDRESS_UINT, input)
      return { kind: 'unwrap-weth', recipient: getAddress(recipient), amountMin }
    }
    case COMMAND.SWEEP: {
      const [token, recipient, amountMin] = decodeAbiParameters(SWEEP, input)
      return {
        kind: 'sweep',
        token: getAddress(token),
        recipient: getAddress(recipient),
        amountMin,
      }
    }
    case COMMAND.V4_SWAP: {
      const actions = decodeV4(input)
      return actions ? { kind: 'v4-swap', actions } : undefined
    }
    default:
      return { kind: 'other', command }
  }
}

/** execute(commands, inputs, deadline) decoded command by command, or undefined if malformed. */
export function decodeRouterCall(data: Hex): RouterCall | undefined {
  try {
    const { args } = decodeFunctionData({ abi: universalRouterAbi, data })
    const [commands, inputs, deadline] = args
    const n = size(commands)
    if (n === 0 || n !== inputs.length) return undefined
    const decoded: RouterCommand[] = []
    for (let i = 0; i < n; i++) {
      const c = decodeCommand(hexToNumber(slice(commands, i, i + 1)), inputs[i])
      if (!c) return undefined
      decoded.push(c)
    }
    return { commands: decoded, deadline }
  } catch {
    return undefined
  }
}

/** What a router call does, when it's one of the swap shapes this app builds. */
export interface SwapSummary {
  readonly route: Route
  readonly sell: Address
  readonly amountIn: bigint
  readonly buy: Address
  readonly minOut: bigint
  readonly deadline: bigint
}

/**
 * The swap in a router call, if it's exactly one of the shapes encodeSwap produces, with the
 * output going to `safe`. Anything else gives undefined and is shown command by command.
 */
export function summarizeSwap(
  call: RouterCall,
  safe: Address,
  c: UniswapContracts,
): SwapSummary | undefined {
  const cmds = call.commands
  const toSafe = (a: Address) => sameAddress(a, safe) || sameAddress(a, MSG_SENDER)
  // v3: [WRAP_ETH]? V3_SWAP_EXACT_IN [UNWRAP_WETH]?
  const wrap = cmds[0]?.kind === 'wrap-eth' ? cmds[0] : undefined
  const i = wrap ? 1 : 0
  const swap = cmds[i]
  if (swap?.kind === 'v3-swap-exact-in') {
    const next = cmds[i + 1]
    const unwrap = next?.kind === 'unwrap-weth' ? next : undefined
    if (cmds.length !== i + 1 + (unwrap ? 1 : 0)) return undefined
    const [first, last] = endsOf(swap.route)
    if (wrap) {
      if (!sameAddress(wrap.recipient, ADDRESS_THIS) || wrap.amount !== swap.amountIn)
        return undefined
      if (swap.payerIsUser || !sameAddress(first, c.weth)) return undefined
    } else if (!swap.payerIsUser) return undefined
    if (unwrap) {
      if (
        !sameAddress(swap.recipient, ADDRESS_THIS) ||
        !sameAddress(last, c.weth) ||
        !toSafe(unwrap.recipient)
      )
        return undefined
    } else if (!toSafe(swap.recipient)) return undefined
    return {
      route: swap.route,
      sell: wrap ? ETH : first,
      amountIn: swap.amountIn,
      buy: unwrap ? ETH : last,
      minOut: unwrap ? unwrap.amountMin : swap.amountOutMin,
      deadline: call.deadline,
    }
  }
  // v4: one V4_SWAP with [SWAP_EXACT_IN(_SINGLE), SETTLE_ALL, TAKE_ALL]
  const only = cmds[0]
  if (cmds.length !== 1 || only?.kind !== 'v4-swap') return undefined
  const [s, settle, take] = only.actions
  if (only.actions.length !== 3 || settle?.kind !== 'settle-all' || take?.kind !== 'take-all')
    return undefined
  if (s?.kind !== 'swap-exact-in' && s?.kind !== 'swap-exact-in-single') return undefined
  const [first, last] = endsOf(s.route)
  if (!s.standardPools || !sameAddress(settle.currency, first) || !sameAddress(take.currency, last))
    return undefined
  if (settle.maxAmount < s.amountIn) return undefined
  const minOut = take.minAmount > s.amountOutMinimum ? take.minAmount : s.amountOutMinimum
  return {
    route: s.route,
    sell: first,
    amountIn: s.amountIn,
    buy: last,
    minOut,
    deadline: call.deadline,
  }
}

// ---------- the TWAP check ----------

export const TWAP_SECONDS = 1800
/** A quote this much worse than the TWAP implies shows an orange warning. */
export const TWAP_TOLERANCE = 0.02

export const v3PoolAbi = parseAbi([
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
])

/** v3 pools are CREATE2 deployments from the factory: the address is computed, not looked up. */
const POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'

export function v3PoolAddress(factory: Address, a: Address, b: Address, fee: number): Address {
  const [t0, t1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  return getContractAddress({
    opcode: 'CREATE2',
    from: factory,
    salt: keccak256(
      encodeAbiParameters(parseAbiParameters('address, address, uint24'), [t0, t1, fee]),
    ),
    bytecodeHash: POOL_INIT_CODE_HASH,
  })
}

/** The v3 pool for each hop (v4 hops use the v3 pool of the same pair and fee, ETH as WETH). */
export const twapPools = (r: Route, c: UniswapContracts) =>
  r.fees.map((fee, i) => {
    const wrap = (t: Address) => (isEth(t) ? c.weth : t)
    const tokenIn = wrap(r.path[i] as Address)
    const tokenOut = wrap(r.path[i + 1] as Address)
    return { pool: v3PoolAddress(c.v3Factory, tokenIn, tokenOut, fee), tokenIn, tokenOut, fee }
  })

/** The mean tick over the window, rounded toward negative infinity like Uniswap's OracleLibrary. */
export function meanTick(tickCumulatives: readonly [bigint, bigint], seconds = TWAP_SECONDS) {
  const delta = tickCumulatives[1] - tickCumulatives[0]
  let tick = delta / BigInt(seconds)
  if (delta < 0n && delta % BigInt(seconds) !== 0n) tick -= 1n
  return Number(tick)
}

/**
 * The output the TWAP implies for `amountIn`, after each pool's fee, in the output token's raw
 * units (a float: this feeds a display-only warning).
 */
export function twapOutput(
  amountIn: bigint,
  hops: readonly { tick: number; tokenIn: Address; tokenOut: Address; fee: number }[],
): number {
  let amount = Number(amountIn)
  for (const h of hops) {
    const zeroForOne = h.tokenIn.toLowerCase() < h.tokenOut.toLowerCase()
    const price = 1.0001 ** (zeroForOne ? h.tick : -h.tick)
    amount = amount * price * (1 - h.fee / 1_000_000)
  }
  return amount
}

/** How much worse the quote is than the TWAP implies (0.03 = 3% worse; negative is better). */
export const shortfall = (quote: bigint, expected: number) =>
  expected > 0 ? 1 - Number(quote) / expected : 0

// ---------- finding the swap in a Safe transaction ----------

/**
 * The swap in a Safe transaction: a direct call to this chain's Universal Router, or the one
 * router call in a MultiSend batch. Only the shapes the app builds are recognized.
 */
export function swapInTx(
  tx: Pick<SafeTx, 'to' | 'data' | 'operation'>,
  safe: Address,
  c: UniswapContracts,
): SwapSummary | undefined {
  const isRouter = (a: Address) => sameAddress(a, c.universalRouter)
  let data: Hex | undefined
  if (tx.operation === 0 && isRouter(tx.to)) data = tx.data
  else if (tx.operation === 1) {
    const routerCalls = (decodeMultiSend(tx.data) ?? []).filter((x) => isRouter(x.to))
    if (routerCalls.length === 1 && routerCalls[0]?.operation === 0) data = routerCalls[0].data
  }
  const call = data ? decodeRouterCall(data) : undefined
  return call ? summarizeSwap(call, safe, c) : undefined
}

// ---------- decoding for review (SPEC §3.13, §7.1 level 3) ----------

const ROUTER_SOURCE = 'Universal Router 2.2.0, decoded by Plain Safe'

/**
 * A call to this chain's Universal Router, decoded command by command. Undefined for any other
 * target; a router call that doesn't decode falls back to the router's plain ABI.
 */
export function decodeRouterFor(chainId: number, to: Address, data: Hex): Decoded | undefined {
  const c = UNISWAP[chainId]
  if (!c || !sameAddress(to, c.universalRouter)) return undefined
  const router = decodeRouterCall(data)
  if (router) return { kind: 'router', level: 3, source: ROUTER_SOURCE, router }
  return decodeCalldata(data, [{ source: 'Universal Router ABI', abi: universalRouterAbi }])
}

/** Where a command sends its output: the explicit recipients (v4's TAKE_ALL pays the caller). */
export function routerRecipients(call: RouterCall): Address[] {
  return call.commands.flatMap((x) => ('recipient' in x ? [x.recipient] : []))
}

/**
 * True when a command leaves its output in the router (ADDRESS_THIS) and no later command
 * collects it: whoever calls the router next can take it.
 */
export function leavesFundsInRouter(call: RouterCall): boolean {
  return call.commands.some((x, i) => {
    const toRouter =
      (x.kind === 'v3-swap-exact-in' || x.kind === 'wrap-eth') &&
      sameAddress(x.recipient, ADDRESS_THIS)
    if (!toRouter) return false
    return !call.commands
      .slice(i + 1)
      .some(
        (y) =>
          y.kind === 'unwrap-weth' ||
          y.kind === 'sweep' ||
          y.kind === 'v4-swap' ||
          (y.kind === 'v3-swap-exact-in' && !y.payerIsUser),
      )
  })
}

/** Commands and v4 actions this decoder doesn't read, and v4 pools with hooks. */
export function undecodedRouterParts(call: RouterCall): string[] {
  return call.commands.flatMap((x) => {
    if (x.kind === 'other') return [`command 0x${x.command.toString(16).padStart(2, '0')}`]
    if (x.kind !== 'v4-swap') return []
    return x.actions.flatMap((a) =>
      a.kind === 'other'
        ? [`v4 action 0x${a.action.toString(16).padStart(2, '0')}`]
        : (a.kind === 'swap-exact-in' || a.kind === 'swap-exact-in-single') && !a.standardPools
          ? ['a v4 pool with hooks or a non-standard tick spacing']
          : [],
    )
  })
}

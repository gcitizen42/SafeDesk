import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  parseAbiParameters,
  zeroAddress,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { decodeBatch, decodeCalldata } from './decode'
import { describeCall } from './describe'
import { knownAbis, safeManagementAbi } from './known-abis'
import { type BatchCall, encodeMultiSend } from './multisend'
import type { SafeTx } from './safe-tx'
import {
  isUnverified,
  needsTypedConfirmation,
  type SafetyInput,
  safetyBanners,
  signingRefused,
} from './safety-rules'
import {
  ADDRESS_THIS,
  decodeRouterFor,
  ETH,
  encodeSwap,
  encodeV3Path,
  MSG_SENDER,
  UNISWAP,
  universalRouterAbi,
} from './uniswap'

const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const token: Address = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9'
const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: ['0x0000000000000000000000000000000000000001', 5n],
})
const base: SafeTx = {
  to: token,
  value: 0n,
  data: transfer,
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 5n,
}
const sources = knownAbis.map((k) => ({ source: k.name, abi: k.abi }))

function input(tx: SafeTx, extra: Partial<SafetyInput> = {}): SafetyInput {
  return {
    safe,
    tx,
    decoded: decodeCalldata(
      tx.data,
      tx.to === safe ? [{ source: 'Safe', abi: safeManagementAbi }] : sources,
    ),
    safeVerified: true,
    onchainNonce: 5n,
    targetIsVerifiedMultiSend: false,
    // By default the target's bytecode contains the called function
    target: { hasCode: true, selectors: new Set([tx.data.slice(0, 10)]), isDelegatedEoa: false },
    ...extra,
  }
}
const rules = (i: SafetyInput) => safetyBanners(i).map((b) => `${b.severity}:${b.rule}`)

describe('safety rules (SPEC §7.4)', () => {
  it('a plain decoded ERC-20 transfer at the current nonce has no banners', () => {
    expect(rules(input(base))).toEqual([])
  })

  it('red: delegatecall to anything but a code-hash-verified MultiSend, with typed confirmation', () => {
    const b = safetyBanners(input({ ...base, operation: 1 }))
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toContain('red:delegatecall')
    expect(needsTypedConfirmation(b)).toBe(true)
    expect(
      rules(input({ ...base, operation: 1 }, { targetIsVerifiedMultiSend: true })),
    ).not.toContain('red:delegatecall')
  })

  it('orange: owner, threshold, module, guard and fallback handler changes on the Safe itself', () => {
    const data = encodeFunctionData({
      abi: safeManagementAbi,
      functionName: 'changeThreshold',
      args: [2n],
    })
    expect(rules(input({ ...base, to: safe, data }))).toEqual(['orange:owner-change'])
    const guard = encodeFunctionData({
      abi: safeManagementAbi,
      functionName: 'setGuard',
      args: [token],
    })
    expect(rules(input({ ...base, to: safe, data: guard }))).toEqual(['orange:owner-change'])
  })

  it('yellow: calldata that cannot be decoded, which also changes the button', () => {
    const b = safetyBanners(
      input(
        { ...base, data: '0xdeadbeef00' },
        { target: { hasCode: true, selectors: new Set(['0xdeadbeef']), isDelegatedEoa: false } },
      ),
    )
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toEqual(['yellow:undecoded'])
    expect(isUnverified(b)).toBe(true)
  })

  it('yellow: non-zero gasPrice, a gasToken or a refundReceiver', () => {
    expect(rules(input({ ...base, gasPrice: 1n }))).toEqual(['yellow:refund'])
    expect(rules(input({ ...base, gasToken: token }))).toEqual(['yellow:refund'])
    expect(rules(input({ ...base, refundReceiver: token }))).toEqual(['yellow:refund'])
  })

  it('info: nonce different from the onchain nonce', () => {
    const b = safetyBanners(input({ ...base, nonce: 7n }))
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toEqual(['info:nonce'])
    expect(b[0]?.title).toMatch(/future/)
    expect(safetyBanners(input({ ...base, nonce: 4n }))[0]?.title).toMatch(/already used/)
  })

  it('yellow: whatsabi finds no code at the target, or the selector missing from its bytecode', () => {
    expect(
      rules(
        input(base, { target: { hasCode: false, selectors: new Set(), isDelegatedEoa: false } }),
      ),
    ).toEqual(['yellow:target-no-code'])
    expect(
      rules(
        input(base, {
          target: { hasCode: true, selectors: new Set(['0x095ea7b3']), isDelegatedEoa: false },
        }),
      ),
    ).toEqual(['yellow:selector-missing'])
  })

  it('red: an unknown or unsupported singleton refuses signing', () => {
    const b = safetyBanners(input(base, { safeVerified: false }))
    expect(b.map((x) => `${x.severity}:${x.rule}`)).toEqual(['red:unsupported-safe'])
    expect(signingRefused(b)).toBe(true)
  })

  it('sorts red, orange, yellow, then info', () => {
    const data = encodeFunctionData({
      abi: safeManagementAbi,
      functionName: 'changeThreshold',
      args: [2n],
    })
    expect(
      rules(input({ ...base, to: safe, data, nonce: 9n, gasPrice: 1n, operation: 1 })),
    ).toEqual(['red:delegatecall', 'yellow:refund', 'info:nonce'])
  })
})

describe('decodeCalldata', () => {
  it('decodes with a known ABI only when the selector is in the bytecode', () => {
    expect(decodeCalldata(transfer, sources)).toMatchObject({
      kind: 'abi',
      level: 3,
      source: 'ERC-20',
      functionName: 'transfer',
    })
    expect(decodeCalldata(transfer, sources, new Set(['0x095ea7b3']))).toEqual({
      kind: 'raw',
      level: 5,
      selector: '0xa9059cbb',
    })
    expect(decodeCalldata('0x', sources)).toEqual({ kind: 'empty' })
    expect(decodeCalldata('0x1234', sources)).toEqual({ kind: 'raw', level: 5 })
  })

  it('treats a matching selector with undecodable arguments as raw', () => {
    expect(decodeCalldata('0xa9059cbb1234', sources)).toMatchObject({ kind: 'raw', level: 5 })
  })
})

describe('batches (MultiSend, P1)', () => {
  const MULTISEND: Address = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'
  const other: Address = '0x000000000000000000000000000000000000dEaD'
  const decodeInner = (c: BatchCall) =>
    decodeCalldata(c.data, c.to === safe ? [{ source: 'Safe', abi: safeManagementAbi }] : sources)
  const batch = (calls: BatchCall[], extra: Partial<SafetyInput> = {}) => {
    const tx: SafeTx = { ...base, to: MULTISEND, operation: 1, data: encodeMultiSend(calls) }
    const decoded = decodeBatch(tx.data, 'MultiSendCallOnly', decodeInner)
    if (!decoded) throw new Error('not a batch')
    return safetyBanners(
      input(tx, {
        decoded,
        targetIsVerifiedMultiSend: true,
        innerTargets: new Map([
          [
            token.toLowerCase(),
            {
              hasCode: true,
              selectors: new Set([transfer.slice(0, 10)]),
              isDelegatedEoa: false,
              isVerifiedMultiSend: false,
            },
          ],
          [
            other.toLowerCase(),
            {
              hasCode: false,
              selectors: new Set(),
              isDelegatedEoa: false,
              isVerifiedMultiSend: false,
            },
          ],
        ]),
        ...extra,
      }),
    )
  }

  it('a verified batch of plain calls has no banners', () => {
    expect(batch([{ operation: 0, to: token, value: 0n, data: transfer }])).toEqual([])
  })

  it('applies every call rule to each call, naming the call', () => {
    const addOwner = encodeFunctionData({
      abi: safeManagementAbi,
      functionName: 'addOwnerWithThreshold',
      args: [other, 1n],
    })
    const banners = batch([
      { operation: 0, to: token, value: 0n, data: transfer },
      { operation: 0, to: safe, value: 0n, data: addOwner },
      { operation: 0, to: other, value: 0n, data: '0xdeadbeef' },
      { operation: 1, to: other, value: 0n, data: '0x' },
    ])
    expect(banners.map((b) => `${b.severity}:${b.rule}:${b.call}`)).toEqual([
      'red:delegatecall:4',
      'orange:owner-change:2',
      'yellow:undecoded:3',
      'yellow:target-no-code:3',
    ])
    expect(banners[0]?.title).toBe('Call 4 of 4: DELEGATECALL to an unknown contract')
    expect(needsTypedConfirmation(banners)).toBe(true)
  })

  it('summarizes a batch from its calls', () => {
    const calls: BatchCall[] = [
      { operation: 0, to: other, value: 10n ** 16n, data: '0x' },
      { operation: 0, to: token, value: 0n, data: transfer },
      { operation: 0, to: token, value: 0n, data: transfer },
    ]
    const tx: SafeTx = { ...base, to: MULTISEND, operation: 1, data: encodeMultiSend(calls) }
    const decoded = decodeBatch(tx.data, 'MultiSendCallOnly', decodeInner)
    expect(decoded && describeCall(tx, decoded, safe, { symbol: 'ETH', decimals: 18 })).toBe(
      'Batch of 3 calls: send 0.01 ETH to 0x0000…dEaD; transfer tokens (0x7b79…E7f9) to 0x0000…0001; …',
    )
  })
})

describe('Universal Router rules (SPEC §3.13)', () => {
  const c = UNISWAP[1] as NonNullable<(typeof UNISWAP)[1]>
  const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
  const routerInput = (data: `0x${string}`, value = 0n): SafetyInput => {
    const tx = { ...base, to: c.universalRouter, value, data }
    const decoded = decodeRouterFor(1, tx.to, tx.data)
    if (!decoded) throw new Error('not decoded')
    return { ...input(tx), decoded }
  }
  const execute = (commands: `0x${string}`, inputs: `0x${string}`[]) =>
    encodeFunctionData({
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [commands, inputs, 1n],
    })
  const v3 = (recipient: Address, payerIsUser = true) =>
    encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool, uint256[]'), [
      recipient,
      1n,
      1n,
      encodeV3Path({ protocol: 'v3', path: [c.usdc, DAI], fees: [100] }),
      payerIsUser,
      [],
    ])

  it('a swap the app builds, paying this Safe, has no banners', () => {
    const call = encodeSwap(
      {
        intent: { sell: c.usdc, buy: ETH, amountIn: 1n },
        route: { protocol: 'v3', path: [c.usdc, c.weth], fees: [500] },
        minOut: 1n,
        recipient: safe,
        deadline: 1n,
      },
      c,
    )
    expect(rules(routerInput(call.data))).toEqual([])
    // The decoded kind feeds the summary too
    expect(
      describeCall(base, routerInput(call.data).decoded, safe, { symbol: 'ETH', decimals: 18 }),
    ).toBe('Swap on Uniswap v3 through the Universal Router')
  })

  it('is red when the output goes to another address', () => {
    const other: Address = '0x000000000000000000000000000000000000dEaD'
    expect(rules(routerInput(execute('0x00', [v3(other)])))).toEqual(['red:swap-recipient'])
    // MSG_SENDER is the Safe itself
    expect(rules(routerInput(execute('0x00', [v3(MSG_SENDER)])))).toEqual([])
  })

  it('is red when output is left in the router for anyone to take', () => {
    expect(rules(routerInput(execute('0x00', [v3(ADDRESS_THIS)])))).toEqual(['red:swap-leftover'])
    const unwrap = encodeAbiParameters(parseAbiParameters('address, uint256'), [safe, 1n])
    expect(rules(routerInput(execute('0x000c', [v3(ADDRESS_THIS), unwrap])))).toEqual([])
  })

  it('is yellow for commands it does not decode', () => {
    expect(rules(routerInput(execute('0x0005', [v3(safe), '0x'])))).toEqual([
      'yellow:swap-undecoded',
    ])
  })

  it('only decodes the router on its own chain, at its own address', () => {
    const data = execute('0x00', [v3(safe)])
    expect(decodeRouterFor(1, DAI, data)).toBeUndefined()
    expect(decodeRouterFor(10, c.universalRouter, data)).toBeUndefined()
    // A router call that doesn't decode falls back to the router's plain ABI
    expect(decodeRouterFor(1, c.universalRouter, execute('0x0000', [v3(safe)]))).toMatchObject({
      kind: 'abi',
      functionName: 'execute',
    })
  })
})

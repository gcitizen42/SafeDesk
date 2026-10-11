import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  getAddress,
  type Hex,
  type Log,
  pad,
  parseAbi,
  toHex,
  zeroAddress,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { execAbi } from './execution'
import { slot, word } from './safe-layout'
import type { SafeTx } from './safe-tx'
import {
  balanceChanges,
  describeEvents,
  level1Outcome,
  level1Request,
  level2Data,
  level2Outcome,
  NATIVE_PSEUDO_TOKEN,
  queuePath,
  queueSimulationRequest,
} from './simulation'

const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const OWNER: Address = '0x6bc5dd8d4e1c7e5a6c1e8f1b3aa3b2d3f7c19251'
const OTHER: Address = '0x255C3912f91eF11bFDadd405F13144a823Da8cc5'
const TOKEN: Address = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9'
const NFT: Address = getAddress('0x000000000000000000000000000000000000aaaa')
const tx: SafeTx = {
  to: OTHER,
  value: 10n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 42n,
}
const HASH: Hex = `0x${'ab'.repeat(32)}`

const events = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 indexed txHash, uint256 payment)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
])
const nft = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

const log = (address: Address, topics: Hex[], data: Hex = '0x') =>
  ({ address, topics, data }) as unknown as Log
const transfer = (address: Address, from: Address, to: Address, value: bigint) =>
  log(
    address,
    encodeEventTopics({ abi: events, eventName: 'Transfer', args: { from, to } }) as Hex[],
    encodeAbiParameters([{ type: 'uint256' }], [value]),
  )
const executed = (name: 'ExecutionSuccess' | 'ExecutionFailure') =>
  log(
    SAFE,
    encodeEventTopics({ abi: events, eventName: name, args: { txHash: HASH } }) as Hex[],
    encodeAbiParameters([{ type: 'uint256' }], [0n]),
  )

describe('level 1: execTransaction with state overrides (SPEC §7.5)', () => {
  it('overrides threshold to 1 and nonce to the transaction nonce, and signs pre-validated', () => {
    const r = level1Request(SAFE, tx, OWNER)
    expect(r.call.from).toBe(OWNER)
    expect(r.call.to).toBe(SAFE)
    expect(r.stateOverrides[0]?.stateDiff).toEqual([
      { slot: slot(4), value: word(1) },
      { slot: slot(5), value: word(42) },
    ])
    const d = decodeFunctionData({ abi: execAbi, data: r.call.data })
    expect(d.args?.[0]).toBe(OTHER)
    expect(d.args?.[9]).toBe(`${pad(OWNER.toLowerCase() as Hex)}${'0'.repeat(64)}01`)
  })

  it('translates a revert, including GS codes', () => {
    const data = encodeErrorResult({
      abi: parseAbi(['error Error(string)']),
      errorName: 'Error',
      args: ['GS013'],
    })
    const o = level1Outcome({ status: 'failure', data, gasUsed: 50_000n }, SAFE, HASH)
    expect(o).toMatchObject({ ok: false, gasUsed: 50_000n })
    expect(!o.ok && o.reason).toMatch(/^GS013: The Safe transaction failed/)
  })

  it('treats ExecutionFailure as a predicted failure, and ExecutionSuccess as success', () => {
    const failed = level1Outcome(
      { status: 'success', data: '0x', gasUsed: 1n, logs: [executed('ExecutionFailure')] },
      SAFE,
      HASH,
    )
    expect(failed.ok).toBe(false)
    const ok = level1Outcome(
      { status: 'success', data: '0x', gasUsed: 1n, logs: [executed('ExecutionSuccess')] },
      SAFE,
      HASH,
    )
    expect(ok).toEqual({ ok: true, gasUsed: 1n })
  })
})

describe('level 2: simulateAndRevert (SPEC §7.5)', () => {
  const accessor: Address = '0x3d4BA2E0884aa488718476ca2FB8Efc291A46199'
  const wrap = (ok: boolean, estimate: bigint, returnData: Hex, delegatecallOk = true) => {
    const inner = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bool' }, { type: 'bytes' }],
      [estimate, ok, returnData],
    )
    return `${word(delegatecallOk ? 1 : 0)}${word((inner.length - 2) / 2).slice(2)}${inner.slice(2)}` as Hex
  }

  it('encodes simulate() for the accessor inside simulateAndRevert', () => {
    const data = level2Data(accessor, tx)
    expect(data.slice(0, 10)).toBe('0xb4faba09')
  })

  it('reads success and the gas estimate', () => {
    expect(level2Outcome(wrap(true, 21_000n, '0x'))).toEqual({ ok: true, gasUsed: 21_000n })
  })

  it('reads the inner revert reason', () => {
    const reason = encodeErrorResult({
      abi: parseAbi(['error Error(string)']),
      errorName: 'Error',
      args: ['nope'],
    })
    const o = level2Outcome(wrap(false, 30_000n, reason))
    expect(o?.ok).toBe(false)
    expect(o && !o.ok && o.reason).toContain('nope')
  })

  it('returns undefined for other shapes', () => {
    expect(level2Outcome(undefined)).toBeUndefined()
    expect(level2Outcome('0x08c379a0')).toBeUndefined()
    expect(level2Outcome(wrap(true, 1n, '0x', false))).toBeUndefined()
  })
})

describe('balance changes', () => {
  it('nets native ETH, ERC-20, ERC-721 and ERC-1155 movements for the Safe', () => {
    const logs = [
      transfer(NATIVE_PSEUDO_TOKEN, SAFE, OTHER, 10n),
      transfer(TOKEN, SAFE, OTHER, 5n),
      transfer(TOKEN, OTHER, SAFE, 2n),
      transfer(TOKEN, OTHER, OWNER, 99n), // not the Safe's
      log(
        NFT,
        encodeEventTopics({
          abi: nft,
          eventName: 'Transfer',
          args: { from: OTHER, to: SAFE, tokenId: 7n },
        }) as Hex[],
      ),
      log(
        NFT,
        encodeEventTopics({
          abi: nft,
          eventName: 'Transfer',
          args: { from: SAFE, to: OTHER, tokenId: 8n },
        }) as Hex[],
      ),
      log(
        TOKEN,
        encodeEventTopics({
          abi: events,
          eventName: 'TransferBatch',
          args: { operator: OTHER, from: OTHER, to: SAFE },
        }) as Hex[],
        encodeAbiParameters(
          [{ type: 'uint256[]' }, { type: 'uint256[]' }],
          [
            [1n, 2n],
            [3n, 4n],
          ],
        ),
      ),
    ]
    expect(balanceChanges(logs, SAFE)).toEqual([
      { kind: 'native', delta: -10n },
      { kind: 'erc20', token: TOKEN, delta: -3n },
      { kind: 'erc721', token: NFT, id: 7n, delta: 1n },
      { kind: 'erc721', token: NFT, id: 8n, delta: -1n },
      { kind: 'erc1155', token: TOKEN, id: 1n, delta: 3n },
      { kind: 'erc1155', token: TOKEN, id: 2n, delta: 4n },
    ])
  })

  it('drops movements that cancel out', () => {
    const logs = [transfer(TOKEN, SAFE, OTHER, 5n), transfer(TOKEN, OTHER, SAFE, 5n)]
    expect(balanceChanges(logs, SAFE)).toEqual([])
  })
})

describe('events', () => {
  it('names known events and skips native pseudo-logs', () => {
    const unknown = log(TOKEN, [toHex(1, { size: 32 })])
    expect(
      describeEvents([
        transfer(NATIVE_PSEUDO_TOKEN, SAFE, OTHER, 1n),
        executed('ExecutionSuccess'),
        unknown,
      ]),
    ).toEqual([
      {
        index: 1,
        address: SAFE,
        name: 'ExecutionSuccess',
        topic0: executed('ExecutionSuccess').topics[0],
      },
      { index: 2, address: TOKEN, topic0: toHex(1, { size: 32 }) },
    ])
  })

  it("names v1.3.0's unindexed Safe events", () => {
    const v130 = parseAbi(['event ChangedGuard(address guard)'])
    const changedGuard = log(
      SAFE,
      encodeEventTopics({ abi: v130, eventName: 'ChangedGuard' }) as Hex[],
      encodeAbiParameters([{ type: 'address' }], [OTHER]),
    )
    expect(describeEvents([changedGuard])[0]?.name).toBe('ChangedGuard')
  })
})

describe('queue simulation (P1)', () => {
  const at = (nonce: bigint, id: string) => ({ id, tx: { ...tx, nonce } })

  it('takes consecutive nonces from the onchain nonce, stopping at a gap or a conflict', () => {
    expect(queuePath([at(5n, 'a'), at(6n, 'b'), at(8n, 'd')], 5n).map((i) => i.id)).toEqual([
      'a',
      'b',
    ])
    expect(
      queuePath([at(5n, 'a'), at(6n, 'b'), at(6n, 'c'), at(7n, 'd')], 5n).map((i) => i.id),
    ).toEqual(['a'])
    expect(queuePath([at(6n, 'b')], 5n)).toEqual([])
  })

  it('overrides only the first nonce and signs each call pre-validated', () => {
    const r = queueSimulationRequest(SAFE, [at(5n, 'a').tx, at(6n, 'b').tx], OWNER)
    expect(r?.stateOverrides[0]?.stateDiff).toEqual([
      { slot: slot(4), value: word(1) },
      { slot: slot(5), value: word(5) },
    ])
    expect(r?.calls).toHaveLength(2)
    expect(r?.calls.every((c) => c.from === OWNER && c.to === SAFE)).toBe(true)
    expect(queueSimulationRequest(SAFE, [], OWNER)).toBeUndefined()
  })
})

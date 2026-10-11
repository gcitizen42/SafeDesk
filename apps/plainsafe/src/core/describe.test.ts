import { type Address, encodeFunctionData, erc20Abi, type Hex, maxUint256, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { type Decoded, decodeBatch, decodeCalldata } from './decode'
import { describeCall, tokenLookup } from './describe'
import { ensAbi, knownAbis, safeManagementAbi } from './known-abis'
import { type BatchCall, encodeMultiSend } from './multisend'
import type { SafeTx } from './safe-tx'

const safe = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const eth = { symbol: 'ETH', decimals: 18 }
const tx = (p: Partial<SafeTx>): SafeTx => ({
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 0n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 0n,
  ...p,
})
const std = knownAbis.map((k) => ({ source: k.name, abi: k.abi }))

describe('describeCall', () => {
  it('describes transfers, owner changes, calls and raw calldata', () => {
    const send = tx({ value: 10n ** 16n })
    expect(describeCall(send, decodeCalldata(send.data, std), safe, eth)).toBe(
      'Send 0.01 ETH to 0x255C…8cc5',
    )
    const add = tx({
      to: safe,
      data: encodeFunctionData({
        abi: safeManagementAbi,
        functionName: 'addOwnerWithThreshold',
        args: ['0x000000000000000000000000000000000000bEEF', 2n],
      }),
    })
    expect(
      describeCall(
        add,
        decodeCalldata(add.data, [{ source: 'Safe', abi: safeManagementAbi }]),
        safe,
        eth,
      ),
    ).toBe('Add owner 0x0000…bEEF and set threshold to 2')
    const approve = tx({
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [safe, 1n] }),
    })
    expect(describeCall(approve, decodeCalldata(approve.data, std), safe, eth)).toBe(
      'Call approve on 0x255C…8cc5',
    )
    const raw = tx({ data: '0xdeadbeef' })
    expect(describeCall(raw, decodeCalldata(raw.data, std), safe, eth)).toBe(
      'Unverified call to 0x255C…8cc5',
    )
  })
})

describe('plain-language summaries from decoded calls', () => {
  // A real Safe's batches (0xeE9e…252E on Mainnet, nonces 66, 73, 74 and 77)
  const SAFE: Address = '0xeE9eeaAB0Bb7D9B969D701f6f8212609EDeA252E'
  const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const tokens = tokenLookup([{ address: USDC, symbol: 'USDC', decimals: 6 }])
  const [r1, r2, r3] = [
    '0x2c413b992381226fb1Aba440DB978eEe03fff199',
    '0xD0a2b03fCCAD184B9eec286FeFA34301E9436206',
    '0x1ffc103849B7Ad8866A151149290f6F496e9b439',
  ] as const
  const transfer = (to: Address, amount: bigint): BatchCall => ({
    to: USDC,
    value: 0n,
    operation: 0,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }),
  })
  const onSafe = (data: Hex): BatchCall => ({ to: SAFE, value: 0n, operation: 0, data })
  const decodeOne = (c: BatchCall) =>
    c.to === SAFE
      ? decodeCalldata(c.data, [{ source: 'Safe', abi: safeManagementAbi }])
      : decodeCalldata(c.data, std)
  const batch = (calls: BatchCall[]) => {
    const data = encodeMultiSend(calls)
    return {
      tx: tx({ to: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2', data, operation: 1 }),
      decoded: decodeBatch(data, 'MultiSendCallOnly v1.4.1', decodeOne) as Decoded,
    }
  }
  const say = (t: { tx: SafeTx; decoded: Decoded }, lookup = tokens) =>
    describeCall(t.tx, t.decoded, SAFE, eth, lookup)

  it('adds up a batch of transfers of one token', () => {
    const b77 = batch([
      transfer(r1, 299_000000n),
      transfer(r2, 599_000000n),
      transfer(r3, 298_000000n),
    ])
    expect(say(b77)).toBe('Send 1196 USDC to 3 addresses')
    const b74 = batch([
      transfer(r1, 1_000000n),
      transfer(r2, 1_000000n),
      transfer(r3, 1_000000n),
      transfer(r3, 1_000000n),
    ])
    expect(say(b74)).toBe('Send 4 USDC to 3 addresses')
    expect(say(batch([transfer(r1, 1n), transfer(r1, 2n)]))).toBe(
      'Send 0.000003 USDC to 0x2c41…f199',
    )
    // A token that isn't in your lists: no symbol or amount to trust
    expect(say(b77, () => undefined)).toBe('Send tokens (0xA0b8…eB48) to 3 addresses')
  })

  it('adds up a batch of ETH sends', () => {
    const b = batch([
      { to: r1, value: 10n ** 17n, operation: 0, data: '0x' },
      { to: r2, value: 2n * 10n ** 17n, operation: 0, data: '0x' },
    ])
    expect(say(b)).toBe('Send 0.3 ETH to 2 addresses')
  })

  it('puts owner changes in one sentence', () => {
    const add = (owner: Address, t: bigint) =>
      onSafe(
        encodeFunctionData({
          abi: safeManagementAbi,
          functionName: 'addOwnerWithThreshold',
          args: [owner, t],
        }),
      )
    const b73 = batch([
      add('0x84f11d97eCFEA55209404f910787E9aFfdc7E51F', 2n),
      add('0xC7551EFBDc39D214C3aCAB61582eF7961FcFF165', 2n),
    ])
    expect(say(b73)).toBe('Add 2 owners and set threshold to 2')
    const swap = onSafe(
      encodeFunctionData({
        abi: safeManagementAbi,
        functionName: 'swapOwner',
        args: [
          '0x8764f2939aE6ed4EcB5baD2cdB7e2B81aA153bd1',
          '0xC0bA7DbB6a4e28b810CDb06A3b3a77a23F618497',
          '0xe29E09fFA0696758555f59A53Ba602e00880504A',
        ],
      }),
    )
    const b66 = batch([swap, add('0x981A76e274fcDC1adac9Cd344CA3933ecA149FdE', 1n)])
    expect(say(b66)).toBe(
      'Replace owner 0xC0bA…8497 with 0xe29E…504A, add owner 0x981A…9FdE and set threshold to 1',
    )
  })

  it('keeps listing the calls of a mixed batch', () => {
    const b = batch([transfer(r1, 1_000000n), { to: r2, value: 1n, operation: 0, data: '0x' }])
    expect(say(b)).toBe(
      'Batch of 2 calls: send 1 USDC to 0x2c41…f199; send 0.000000000000000001 ETH to 0xD0a2…6206',
    )
  })

  it('says how much a known token sends or approves', () => {
    const one = (data: Hex) => ({ tx: tx({ to: USDC, data }), decoded: decodeCalldata(data, std) })
    expect(
      say(
        one(
          encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [r1, 799_000000n] }),
        ),
      ),
    ).toBe('Send 799 USDC to 0x2c41…f199')
    expect(
      say(
        one(
          encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: ['0x000000000022D473030F116dDEE9F6B43aC78BA3', maxUint256],
          }),
        ),
      ),
    ).toBe('Approve 0x0000…8BA3 to spend unlimited USDC')
  })

  it('reads ENS calls as what they change', () => {
    const resolver: Address = '0xF29100983E058B709F3D539b0c765937B804AC15'
    const node = `0x${'54'.repeat(32)}` as Hex
    const target = '0x3AF5CFc7C7f29Da9d7758339b8eaB6a78550Cbed'
    const ens = (to: Address, data: Hex) => ({
      tx: tx({ to, data }),
      decoded: decodeCalldata(data, std),
    })
    const call = <F extends (typeof ensAbi)[number]['name']>(
      functionName: F,
      args: readonly unknown[],
    ) => encodeFunctionData({ abi: ensAbi, functionName, args } as never) as Hex
    const setAddr = (coin: bigint) => call('setAddr', [node, coin, target.toLowerCase()])
    expect(say(ens(resolver, setAddr(60n)))).toBe("Set a name's ETH address to 0x3AF5…Cbed")
    expect(say(ens(resolver, setAddr(2147483658n)))).toBe(
      "Set a name's chain 10 address to 0x3AF5…Cbed",
    )
    expect(say(ens(resolver, call('setAddr', [node, 0n, '0x0014abcdef'])))).toBe(
      "Set a name's BTC address to 0x0014abcd…",
    )
    // Nonce 69: two coin types pointed at one address in a multicall
    expect(say(ens(resolver, call('multicall', [[setAddr(60n), setAddr(2147483648n)]])))).toBe(
      "Set a name's ETH and default EVM addresses to 0x3AF5…Cbed",
    )
    expect(
      say(
        ens(
          resolver,
          call('multicall', [
            [
              call('setText', [node, 'url', 'https://example.com']),
              call('setContenthash', [node, '0xe301']),
            ],
          ]),
        ),
      ),
    ).toBe(`Set a name's "url" text record; set a name's contenthash`)
    expect(
      say(
        ens(
          resolver,
          call('multicall', [
            [
              call('setText', [node, 'url', 'https://example.com']),
              call('setContenthash', [node, '0xe301']),
              call('setText', [node, 'avatar', 'x']),
              call('setText', [node, 'com.github', 'x']),
            ],
          ]),
        ),
      ),
    ).toBe(`Set a name's "url" text record; set a name's contenthash; and 2 more calls`)
    expect(
      say(
        ens(
          '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e',
          call('setSubnodeRecord', [node, node, SAFE, resolver, 0n]),
        ),
      ),
    ).toBe('Create or update a subname, owned by this Safe')
    expect(
      say(
        ens('0xa58E81fe9b61B5c3fE2AFD33CF304c454AbFc7Cb', call('setName', ['devrel.enslabs.eth'])),
      ),
    ).toBe(`Set this Safe's primary name to "devrel.enslabs.eth"`)
    // Nonce 52: a five-year renewal through the 2025 controller
    expect(
      say(
        ens(
          '0x59E16fcCd424Cc24e280Be16E11Bcd56fb0CE547',
          call('renew', ['integration-tests', 157766400n, `0x${'00'.repeat(32)}`]),
        ),
      ),
    ).toBe('Renew "integration-tests.eth" for 5 years')
  })
})

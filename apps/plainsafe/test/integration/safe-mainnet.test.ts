// SPEC §4.4 / §13: the planning verification script (docs/planning/verification/safe.ts), as a
// test of our own core/ code against real Mainnet Safes of each supported version.
// Runs only when MAINNET_RPC_URL is set: `MAINNET_RPC_URL=https://… bun run test:integration`.
// Signing uses throwaway keys made owners through eth_simulateV1 state overrides. Never real keys.
import {
  type Address,
  createPublicClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  http,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkAuthenticity } from '@/core/authenticity'
import { deployments } from '@/core/deployments'
import { ownersSlot, SLOT, singletonFromSlot0, slot, word } from '@/core/safe-layout'
import { type SafeTx, safeTxHashes, safeTxTypedData } from '@/core/safe-tx'
import { encodeSignatures, prevalidatedSignature } from '@/core/signatures'

const RPC = process.env.MAINNET_RPC_URL

const SAFES = [
  {
    address: '0x4F2083f5fBede34C2714aFfb3105539775f7FE64',
    version: '1.3.0',
    note: 'ENS Endowment',
  },
  {
    address: '0x27e9f607817A05669D9C3794fb9Cd43724f61614',
    version: '1.4.1',
    note: 'L2, 1.4.1 factory',
  },
  {
    address: '0x7b2486f2fc0e1DAC78D866b8b7fb04b19c66C102',
    version: '1.5.0',
    note: '1.5.0 factory',
  },
] as const satisfies readonly { address: Address; version: string; note: string }[]

const safeAbi = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function VERSION() view returns (string)',
  'function domainSeparator() view returns (bytes32)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
  'function simulateAndRevert(address targetContract, bytes calldataPayload)',
])
const accessorAbi = parseAbi([
  'function simulate(address to, uint256 value, bytes data, uint8 operation) returns (uint256 estimate, bool success, bytes returnData)',
])
const EXECUTION_SUCCESS = keccak256(toHex('ExecutionSuccess(bytes32,uint256)'))
const ETH_PSEUDO = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const args = (t: SafeTx) =>
  [
    t.to,
    t.value,
    t.data,
    t.operation,
    t.safeTxGas,
    t.baseGas,
    t.gasPrice,
    t.gasToken,
    t.refundReceiver,
    t.nonce,
  ] as const

describe.skipIf(!RPC)('Safe assumptions on Mainnet (SPEC §4.4)', () => {
  const client = createPublicClient({ chain: mainnet, transport: http(RPC, { retryCount: 3 }) })
  it('proxy runtime code hashes re-derived from the factories match the bundled table (SPEC §4.2)', async () => {
    const factoryAbi = parseAbi(['function proxyCreationCode() pure returns (bytes)'])
    const factories: Address[] = [
      '0x12302fE9c02ff50939BaAaaf415fc226C078613C', // 1.0.0
      '0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B', // 1.1.1
      '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2', // 1.3.0
      '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67', // 1.4.1
      '0x14F2982D601c9458F93bd70B218933A6f8165e7b', // 1.5.0
    ]
    const bundled = new Set(deployments.proxies.map((p) => p.codeHash.toLowerCase()))
    for (const factory of factories) {
      const creation = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: 'proxyCreationCode',
      })
      const singleton = encodeAbiParameters(
        [{ type: 'address' }],
        ['0x2222222222222222222222222222222222222222'],
      )
      const { data } = await client.call({ data: `${creation}${singleton.slice(2)}` as Hex })
      expect(bundled.has(keccak256(data as Hex).toLowerCase())).toBe(true)
    }
  })

  describe.each(SAFES)('$version Safe $address ($note)', ({ address: safe, version }) => {
    let block: bigint
    let owners: readonly Address[]
    let threshold: bigint
    let nonce: bigint
    let tx: SafeTx

    beforeAll(async () => {
      block = await client.getBlockNumber()
      const read = <F extends 'getOwners' | 'getThreshold' | 'nonce'>(functionName: F) =>
        client.readContract({ address: safe, abi: safeAbi, functionName, blockNumber: block })
      ;[owners, threshold, nonce] = await Promise.all([
        read('getOwners'),
        read('getThreshold'),
        read('nonce'),
      ])
      tx = {
        to: '0x000000000000000000000000000000000000dEaD',
        value: 0n,
        data: '0x',
        operation: 0,
        safeTxGas: 0n,
        baseGas: 0n,
        gasPrice: 0n,
        gasToken: zeroAddress,
        refundReceiver: zeroAddress,
        nonce,
      }
    })

    const getTransactionHash = (t: SafeTx) =>
      client.readContract({
        address: safe,
        abi: safeAbi,
        functionName: 'getTransactionHash',
        args: args(t),
        blockNumber: block,
      })

    /** Run the real execTransaction through eth_simulateV1 with state overrides on the Safe. */
    const simulate = async (
      t: SafeTx,
      signatures: Hex,
      from: Address,
      stateDiff: { slot: Hex; value: Hex }[],
      balance?: bigint,
    ) => {
      const [result] = await client.simulateBlocks({
        blockNumber: block,
        blocks: [
          {
            stateOverrides: [{ address: safe, stateDiff, ...(balance ? { balance } : {}) }],
            calls: [
              {
                from,
                to: safe,
                data: encodeFunctionData({
                  abi: safeAbi,
                  functionName: 'execTransaction',
                  args: [...args(t).slice(0, 9), signatures] as never,
                }),
              },
            ],
          },
        ],
        traceTransfers: true,
        validation: false,
      })
      const call = result?.calls[0]
      if (!call) throw new Error('no simulation result')
      return call
    }
    const makeOwner = (a: Address) => ({ slot: ownersSlot(a), value: word(1) })
    const thresholdTo = (n: number) => ({ slot: slot(SLOT.threshold), value: word(n) })
    const stranger = () => privateKeyToAccount(generatePrivateKey()).address
    const gsCode = (e?: Error) => e?.message.match(/GS0\d\d/)?.[0]

    it('passes the authenticity check (proxy and singleton code hashes); the version comes from the code', async () => {
      const [proxyCode, s0, reported] = await Promise.all([
        client.getCode({ address: safe, blockNumber: block }),
        client.getStorageAt({ address: safe, slot: slot(SLOT.singleton), blockNumber: block }),
        client.readContract({
          address: safe,
          abi: safeAbi,
          functionName: 'VERSION',
          blockNumber: block,
        }),
      ])
      const singleton = singletonFromSlot0(s0 as Hex)
      const singletonCode = await client.getCode({ address: singleton, blockNumber: block })
      const a = checkAuthenticity(deployments, {
        proxyCode,
        singleton,
        singletonCode,
        reportedVersion: reported,
      })
      expect(a).toMatchObject({ status: 'verified', version })
      expect(a).not.toHaveProperty('versionMismatch')
    })

    it('storage slots 3, 4 and 5 hold ownerCount, threshold and nonce (SPEC §4.3)', async () => {
      const [s3, s4, s5] = await Promise.all(
        [SLOT.ownerCount, SLOT.threshold, SLOT.nonce].map((n) =>
          client.getStorageAt({ address: safe, slot: slot(n), blockNumber: block }),
        ),
      )
      expect(BigInt(s3 as Hex)).toBe(BigInt(owners.length))
      expect(BigInt(s4 as Hex)).toBe(threshold)
      expect(BigInt(s5 as Hex)).toBe(nonce)
    })

    it('our domain hash equals domainSeparator()', async () => {
      const onchain = await client.readContract({
        address: safe,
        abi: safeAbi,
        functionName: 'domainSeparator',
        blockNumber: block,
      })
      expect(safeTxHashes(1, safe, tx).domain).toBe(onchain)
    })

    it('our safeTxHash equals getTransactionHash(), including calldata, delegatecall, refunds and a future nonce', async () => {
      expect(safeTxHashes(1, safe, tx).safeTx).toBe(await getTransactionHash(tx))
      const complex: SafeTx = {
        ...tx,
        value: 12345n,
        data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000000000000000001',
        operation: 1,
        safeTxGas: 7n,
        baseGas: 8n,
        gasPrice: 9n,
        gasToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        refundReceiver: '0x000000000000000000000000000000000000bEEF',
        nonce: nonce + 5n,
      }
      expect(safeTxHashes(1, safe, complex).safeTx).toBe(await getTransactionHash(complex))
    })

    it('an EIP-712 signature from a test key (made owner by override) executes, and ExecutionSuccess carries our safeTxHash', async () => {
      const key = privateKeyToAccount(generatePrivateKey())
      const sig = await key.signTypedData(safeTxTypedData(1, safe, tx))
      expect([27, 28]).toContain(Number.parseInt(sig.slice(-2), 16))
      const r = await simulate(tx, sig, stranger(), [thresholdTo(1), makeOwner(key.address)])
      expect(r.status).toBe('success')
      const hash = safeTxHashes(1, safe, tx).safeTx
      const event = r.logs?.find((l) => l.topics[0] === EXECUTION_SUCCESS)
      // v1.3.0 has txHash in data; v1.4.1+ indexes it (SPEC §4.1)
      expect(event && (event.topics[1] === hash || event.data.startsWith(hash))).toBe(true)
    })

    it('a pre-validated signature executes when sent from that owner, and fails from anyone else (SPEC §7.5 level 1)', async () => {
      const owner = owners[0] as Address
      const sig = prevalidatedSignature(owner)
      expect((await simulate(tx, sig, owner, [thresholdTo(1)])).status).toBe('success')
      expect((await simulate(tx, sig, stranger(), [thresholdTo(1)])).status).toBe('failure')
    })

    it('two signatures execute sorted ascending, and revert with GS026 sorted descending', async () => {
      const k1 = privateKeyToAccount(generatePrivateKey())
      const k2 = privateKeyToAccount(generatePrivateKey())
      const typed = safeTxTypedData(1, safe, tx)
      const sigs = [
        { signer: k1.address, data: await k1.signTypedData(typed) },
        { signer: k2.address, data: await k2.signTypedData(typed) },
      ]
      const diff = [thresholdTo(2), makeOwner(k1.address), makeOwner(k2.address)]
      const ascending = encodeSignatures(sigs)
      expect((await simulate(tx, ascending, stranger(), diff)).status).toBe('success')
      const sorted = [...sigs].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1))
      const descending = `0x${[...sorted]
        .reverse()
        .map((s) => s.data.slice(2))
        .join('')}` as Hex
      const r = await simulate(tx, descending, stranger(), diff)
      expect(r.status).toBe('failure')
      expect(gsCode(r.error)).toBe('GS026')
    })

    it('a signature over a different safeTxHash reverts with GS026', async () => {
      const key = privateKeyToAccount(generatePrivateKey())
      const wrong = await key.signTypedData(
        safeTxTypedData(1, safe, { ...tx, nonce: tx.nonce + 1n }),
      )
      const r = await simulate(tx, wrong, stranger(), [thresholdTo(1), makeOwner(key.address)])
      expect(r.status).toBe('failure')
      expect(gsCode(r.error)).toBe('GS026')
    })

    it('a future nonce set through slot 5 executes, and a 1-wei ETH transfer shows as a 0xEeee… pseudo-log', async () => {
      const key = privateKeyToAccount(generatePrivateKey())
      const future: SafeTx = { ...tx, value: 1n, nonce: tx.nonce + 3n }
      const sig = await key.signTypedData(safeTxTypedData(1, safe, future))
      const r = await simulate(
        future,
        sig,
        stranger(),
        [
          thresholdTo(1),
          { slot: slot(SLOT.nonce), value: word(future.nonce) },
          makeOwner(key.address),
        ],
        10n ** 18n,
      )
      expect(r.status).toBe('success')
      expect(r.logs?.some((l) => l.address.toLowerCase() === ETH_PSEUDO)).toBe(true)
    })

    it('simulateAndRevert(SimulateTxAccessor, simulate(…)) decodes to success with a gas estimate (SPEC §7.5 level 2)', async () => {
      const accessor = deployments.simulateTxAccessor.find(
        (a) => a.version === version && a.variant === 'canonical',
      )?.address as Address
      const payload = encodeFunctionData({
        abi: accessorAbi,
        functionName: 'simulate',
        args: [tx.to, 0n, '0x', 0],
      })
      const data = encodeFunctionData({
        abi: safeAbi,
        functionName: 'simulateAndRevert',
        args: [accessor, payload],
      })
      let raw: Hex | undefined
      try {
        await client.call({ to: safe, data, blockNumber: block })
      } catch (e) {
        const found = (e as { walk?: (f: (x: unknown) => boolean) => unknown }).walk?.(
          (x) => typeof (x as { data?: unknown })?.data === 'string',
        ) as { data?: Hex } | undefined
        raw = found?.data
      }
      expect(raw).toBeDefined()
      const hex = raw as Hex
      // revert data: abi.encode(bool success, bytes response)
      const success = BigInt(hex.slice(0, 66)) === 1n
      const length = Number(BigInt(`0x${hex.slice(66, 130)}`))
      const response = `0x${hex.slice(130, 130 + length * 2)}` as Hex
      const [estimate, innerSuccess] = decodeAbiParameters(
        [{ type: 'uint256' }, { type: 'bool' }, { type: 'bytes' }],
        response,
      )
      expect(success).toBe(true)
      expect(innerSuccess).toBe(true)
      expect(estimate).toBeGreaterThan(0n)
    })
  })
})

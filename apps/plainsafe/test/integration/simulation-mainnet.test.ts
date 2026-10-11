// SPEC §7.5: the app's simulation building blocks against real Mainnet Safes of each supported
// version. Runs only when MAINNET_RPC_URL is set. Read-only: state overrides, no keys at all.
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
} from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { deployments, findSimulateTxAccessor } from '@/core/deployments'
import { revertData } from '@/core/execution'
import { type SafeTx, safeTxHashes } from '@/core/safe-tx'
import {
  balanceChanges,
  level1Outcome,
  level1Request,
  level2Data,
  level2Outcome,
} from '@/core/simulation'

const RPC = process.env.MAINNET_RPC_URL
const SAFES = [
  { address: '0x4F2083f5fBede34C2714aFfb3105539775f7FE64', version: '1.3.0' },
  { address: '0x27e9f607817A05669D9C3794fb9Cd43724f61614', version: '1.4.1' },
  { address: '0x7b2486f2fc0e1DAC78D866b8b7fb04b19c66C102', version: '1.5.0' },
] as const satisfies readonly { address: Address; version: string }[]
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x000000000000000000000000000000000000dEaD'
const safeAbi = parseAbi([
  'function getOwners() view returns (address[])',
  'function nonce() view returns (uint256)',
])

// Some of these Safes hold no ETH, so the tests give them 1 ETH to send from.
const funded = (safe: Address) => ({ address: safe, balance: 10n ** 18n })

const base = (nonce: bigint): SafeTx => ({
  to: RECIPIENT,
  value: 1n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce,
})

describe.skipIf(!RPC)('simulation on Mainnet Safes (SPEC §7.5)', () => {
  const client = createPublicClient({ chain: mainnet, transport: http(RPC, { retryCount: 3 }) })

  for (const s of SAFES) {
    it(`v${s.version}: level 1 succeeds for a 1 wei send and reports the balance change`, async () => {
      const blockNumber = await client.getBlockNumber()
      const [owners, nonce] = await Promise.all([
        client.readContract({
          address: s.address,
          abi: safeAbi,
          functionName: 'getOwners',
          blockNumber,
        }),
        client.readContract({
          address: s.address,
          abi: safeAbi,
          functionName: 'nonce',
          blockNumber,
        }),
      ])
      const tx = base(nonce)
      const req = level1Request(s.address, tx, owners[0] as Address)
      const [override] = req.stateOverrides
      const [block] = await client.simulateBlocks({
        blockNumber,
        traceTransfers: true,
        validation: false,
        blocks: [{ calls: [req.call], stateOverrides: [{ ...override, ...funded(s.address) }] }],
      })
      const call = block?.calls[0]
      if (!call) throw new Error('no result')
      const outcome = level1Outcome(call, s.address, safeTxHashes(1, s.address, tx).safeTx)
      expect(outcome.ok).toBe(true)
      expect(balanceChanges(call.logs ?? [], s.address)).toEqual([{ kind: 'native', delta: -1n }])
    })

    it(`v${s.version}: level 1 predicts failure for a USDC transfer the Safe can't cover`, async () => {
      const blockNumber = await client.getBlockNumber()
      const owners = await client.readContract({
        address: s.address,
        abi: safeAbi,
        functionName: 'getOwners',
        blockNumber,
      })
      const tx: SafeTx = {
        ...base(7n),
        to: USDC,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [RECIPIENT, 10n ** 30n],
        }),
      }
      const req = level1Request(s.address, tx, owners[0] as Address)
      const [block] = await client.simulateBlocks({
        blockNumber,
        validation: false,
        blocks: [{ calls: [req.call], stateOverrides: req.stateOverrides }],
      })
      const call = block?.calls[0]
      if (!call) throw new Error('no result')
      const outcome = level1Outcome(call, s.address, safeTxHashes(1, s.address, tx).safeTx)
      expect(outcome.ok).toBe(false)
      // v1.3.0 and v1.4.1 report GS013; v1.5.0 passes the token's own revert through
      if (!outcome.ok && s.version !== '1.5.0') expect(outcome.reason).toMatch(/^GS013/)
    })

    it(`v${s.version}: level 2 (simulateAndRevert) succeeds through a code-hash-verified accessor`, async () => {
      const blockNumber = await client.getBlockNumber()
      const accessor = deployments.simulateTxAccessor.find(
        (a) => a.version === s.version && a.variant === 'canonical',
      )
      if (!accessor) throw new Error(`no ${s.version} accessor`)
      const code = await client.getCode({ address: accessor.address, blockNumber })
      expect(findSimulateTxAccessor(keccak256(code ?? '0x'))?.address).toBe(
        getAddress(accessor.address),
      )
      const err = await client
        .call({
          to: s.address,
          data: level2Data(accessor.address, base(0n)),
          blockNumber,
          stateOverride: [funded(s.address)],
        })
        .then(() => undefined)
        .catch((e: unknown) => e)
      const outcome = level2Outcome(revertData(err))
      expect(outcome?.ok).toBe(true)
    })
  }
})

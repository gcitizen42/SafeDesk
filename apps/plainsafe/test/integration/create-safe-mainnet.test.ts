// SPEC §3.14: creating a Safe on Mainnet exactly as the app sends it, through eth_simulateV1. The
// factory must create the predicted address, and the new Safe must have the owners, threshold and
// singleton asked for, with proxy and singleton code that pass the authenticity check. Runs only
// when MAINNET_RPC_URL is set. Owners are fresh local accounts; nothing is signed.
import {
  type Address,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { checkAuthenticity } from '@/core/authenticity'
import { planCreation, proxyFactoryAbi } from '@/core/create-safe'
import { deployments } from '@/core/deployments'

const RPC = process.env.MAINNET_RPC_URL
const safeAbi = parseAbi([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
])

describe.skipIf(!RPC)('creating a Safe on Mainnet (SPEC §3.14)', () => {
  const client = createPublicClient({ chain: mainnet, transport: http(RPC) })
  const owners = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()).address)
  const plan = planCreation({ chainId: 1, owners, threshold: 2, saltNonce: 20260926n })

  it('uses the official contracts, checked by code hash', async () => {
    const { factory, singleton, fallbackHandler } = plan.contracts
    expect(singleton.contractName).toBe('Safe') // L1 edition on Mainnet
    for (const c of [factory, singleton, fallbackHandler]) {
      const code = await client.getCode({ address: c.address })
      expect(code && keccak256(code), c.contractName).toBe(c.codeHash)
    }
  })

  it('creates the predicted Safe with the owners and threshold asked for', async () => {
    const sender = owners[0] as Address
    const { data } = await client.call({ account: sender, to: plan.to, data: plan.data })
    expect(
      decodeFunctionResult({
        abi: proxyFactoryAbi,
        functionName: 'createProxyWithNonce',
        data: data ?? '0x',
      }),
    ).toBe(plan.address)

    const read = (functionName: 'getOwners' | 'getThreshold' | 'nonce') => ({
      to: plan.address,
      data: encodeFunctionData({ abi: safeAbi, functionName }),
    })
    const [block] = await client.simulateBlocks({
      validation: false,
      blocks: [
        {
          calls: [
            { account: sender, to: plan.to, data: plan.data },
            read('getOwners'),
            read('getThreshold'),
            read('nonce'),
          ],
        },
      ],
    })
    const [create, getOwners, getThreshold, nonce] = block?.calls ?? []
    expect(create?.status, create?.error?.message).toBe('success')
    const created = parseEventLogs({
      abi: proxyFactoryAbi,
      eventName: 'ProxyCreation',
      logs: create?.logs ?? [],
    })
    expect(created[0]?.args.proxy).toBe(plan.address)
    expect(
      decodeFunctionResult({
        abi: safeAbi,
        functionName: 'getOwners',
        data: getOwners?.data ?? '0x',
      }),
    ).toEqual(owners)
    expect(
      decodeFunctionResult({
        abi: safeAbi,
        functionName: 'getThreshold',
        data: getThreshold?.data ?? '0x',
      }),
    ).toBe(2n)
    expect(
      decodeFunctionResult({ abi: safeAbi, functionName: 'nonce', data: nonce?.data ?? '0x' }),
    ).toBe(0n)
  })

  it('makes a proxy that passes the authenticity check', async () => {
    // The proxy's runtime code: the factory's creation code run with the singleton as argument
    const { data: proxyCode } = await client.call({
      data: `${plan.contracts.factory.proxyCreationCode}${plan.contracts.singleton.address.slice(2).toLowerCase().padStart(64, '0')}`,
    })
    const singletonCode = await client.getCode({ address: plan.contracts.singleton.address })
    const result = checkAuthenticity(deployments, {
      proxyCode: proxyCode ?? '0x',
      singleton: plan.contracts.singleton.address,
      singletonCode,
    })
    expect(result.status).toBe('verified')
    if (result.status === 'verified') {
      expect(result.version).toBe('1.4.1')
      expect(result.l2).toBe(false)
    }
  })
})

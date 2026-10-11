import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Hex,
  zeroAddress,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  createdSafe,
  creationContracts,
  ownersProblem,
  planCreation,
  predictSafeAddress,
  proxyFactoryAbi,
  safeSetupAbi,
  usesL2,
} from './create-safe'

// Real Safes created on Mainnet by the v1.4.1 factory, read from their creation transactions
const MAINNET = [
  {
    // Safe (L1) singleton: tx 0xcd89959eb3fa41b7df1c0da2a23a2e3d3b30835c668a06f43f12a2cd2b4147a3 (block 26062262)
    proxy: '0x00C543d5A3680431E3dbC2f4d2583e8C46e92368',
    singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
    saltNonce: 0n,
    initializer:
      '0xb63e800d00000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bd89a1ce4dde368ffab0ec35506eece0b1ffdc5400000000000000000000000000000000000000000000000000000000000001a0000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005afe7a11e70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000eb1d06c2d9439225bf14491c84e4755ab0471fd300000000000000000000000037c89cc168f080b6a388232b67b809b82365a4ba00000000000000000000000069b050b068879302a0f6b90ff8f05d392309d5520000000000000000000000002d8ffcac4d71e672df4a911d03ae1e29b01908ba0000000000000000000000000000000000000000000000000000000000000024fe51f64300000000000000000000000029fcb43b46531bca003ddc8fcb67ffe91900c76200000000000000000000000000000000000000000000000000000000',
  },
  {
    // SafeL2 singleton: tx 0xaa29fc910b13f0ea1b21d04234e530d711aabb14aa68befe5cd0034053278074 (block 26062630)
    proxy: '0x3261Aa698f5c3FF0aA6e9Cce7bCBba5F1D9e5f92',
    singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
    saltNonce: 111379289843703428230426042205209598600393602120535466600726451819102316773556n,
    initializer:
      '0xb63e800d0000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec990000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000379739a949e5b2afa2c9cb0555092727725f726c0000000000000000000000007fe25c280cf7e910ae808b72082df57fdc319ec90000000000000000000000000000000000000000000000000000000000000000',
  },
] as const

const A = '0x1111111111111111111111111111111111111111' as Address
const B = '0x2222222222222222222222222222222222222222' as Address
const C = '0x3333333333333333333333333333333333333333' as Address

describe('creating a Safe (SPEC §3.14)', () => {
  it('uses Safe on Mainnet and Sepolia, SafeL2 everywhere else', () => {
    expect(usesL2(1)).toBe(false)
    expect(usesL2(11155111)).toBe(false)
    expect(usesL2(8453)).toBe(true)
    expect(usesL2(10)).toBe(true)
    const l1 = creationContracts(1)
    expect(l1.singleton.contractName).toBe('Safe')
    expect(l1.singleton.address).toBe('0x41675C099F32341bf84BFc5382aF534df5C7461a')
    const l2 = creationContracts(8453)
    expect(l2.singleton.contractName).toBe('SafeL2')
    expect(l2.singleton.address).toBe('0x29fcB43b46531BcA003ddC8FCB67FFE91900C762')
    for (const c of [l1, l2]) {
      expect(c.version).toBe('1.4.1')
      expect(c.factory.address).toBe('0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67')
      expect(c.fallbackHandler.address).toBe('0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99')
    }
  })

  it('predicts the address of real Mainnet Safes from their creation calls', () => {
    const { factory } = creationContracts(1)
    for (const v of MAINNET) {
      expect(
        predictSafeAddress({
          factory: factory.address,
          proxyCreationCode: factory.proxyCreationCode,
          singleton: v.singleton,
          initializer: v.initializer,
          saltNonce: v.saltNonce,
        }),
      ).toBe(getAddress(v.proxy))
    }
  })

  it('builds the setup call and the factory call', () => {
    const plan = planCreation({ chainId: 11155111, owners: [A, B, C], threshold: 2, saltNonce: 7n })
    const setup = decodeFunctionData({ abi: safeSetupAbi, data: plan.initializer })
    expect(setup.args).toEqual([
      [A, B, C],
      2n,
      zeroAddress,
      '0x',
      '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
      zeroAddress,
      0n,
      zeroAddress,
    ])
    const call = decodeFunctionData({ abi: proxyFactoryAbi, data: plan.data })
    expect(call.args).toEqual([plan.contracts.singleton.address, plan.initializer, 7n])
    expect(plan.to).toBe(plan.contracts.factory.address)
    // A different salt, owner order or chain edition is a different Safe
    expect(
      planCreation({ chainId: 11155111, owners: [A, B, C], threshold: 2, saltNonce: 8n }).address,
    ).not.toBe(plan.address)
    expect(
      planCreation({ chainId: 8453, owners: [A, B, C], threshold: 2, saltNonce: 7n }).address,
    ).not.toBe(plan.address)
  })

  it('rejects owners and thresholds the Safe would reject', () => {
    expect(ownersProblem([], 1)).toMatch(/at least one owner/)
    expect(ownersProblem([A, A], 1)).toMatch(/listed twice/)
    expect(ownersProblem([A, A.toLowerCase() as Address], 1)).toMatch(/listed twice/)
    expect(ownersProblem([zeroAddress], 1)).toMatch(/can't be an owner/)
    expect(ownersProblem(['0x0000000000000000000000000000000000000001'], 1)).toMatch(
      /can't be an owner/,
    )
    expect(ownersProblem([A, B], 0)).toMatch(/between 1 and 2/)
    expect(ownersProblem([A, B], 3)).toMatch(/between 1 and 2/)
    expect(ownersProblem([A, B], 2)).toBeUndefined()
    expect(() => planCreation({ chainId: 1, owners: [A], threshold: 2, saltNonce: 1n })).toThrow()
  })

  it('reads the new Safe from the factory event, and only from the factory', () => {
    const factory = creationContracts(1).factory.address
    const log = (address: Address) => ({
      address,
      topics: encodeEventTopics({
        abi: proxyFactoryAbi,
        eventName: 'ProxyCreation',
        args: { proxy: B },
      }) as Hex[],
      data: encodeAbiParameters([{ type: 'address' }], [C]),
    })
    expect(createdSafe([log(A), log(factory)], factory)).toBe(B)
    expect(createdSafe([log(A)], factory)).toBeUndefined()
  })
})

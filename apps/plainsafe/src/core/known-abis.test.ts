import { toFunctionSelector, toFunctionSignature } from 'viem'
import { describe, expect, it } from 'vitest'
import { decodeCalldata } from './decode'
import { describeCall } from './describe'
import { ensAbi, knownAbis } from './known-abis'
import type { SafeTx } from './safe-tx'

const std = knownAbis.map((k) => ({ source: k.name, abi: k.abi }))
const safe = '0xeE9eeaAB0Bb7D9B969D701f6f8212609EDeA252E'

describe('bundled ENS ABI', () => {
  it('matches the selectors of the Mainnet contracts verified on Sourcify', () => {
    // From the verified ABIs of ENSRegistryWithFallback, PublicResolver, ReverseRegistrar, both
    // ETHRegistrarControllers, BaseRegistrarImplementation and NameWrapper (read 2026-09-26)
    const verified: Record<string, string> = {
      'setOwner(bytes32,address)': '0x5b0fc9c3',
      'setRecord(bytes32,address,address,uint64)': '0xcf408823',
      'setResolver(bytes32,address)': '0x1896f70a',
      'setSubnodeOwner(bytes32,bytes32,address)': '0x06ab5923',
      'setSubnodeRecord(bytes32,bytes32,address,address,uint64)': '0x5ef2c7f0',
      'setTTL(bytes32,uint64)': '0x14ab9038',
      'approve(bytes32,address,bool)': '0xa4b91a01',
      'clearRecords(bytes32)': '0x3603d758',
      'multicall(bytes[])': '0xac9650d8',
      'multicallWithNodeCheck(bytes32,bytes[])': '0xe32954eb',
      'setABI(bytes32,uint256,bytes)': '0x623195b0',
      'setAddr(bytes32,address)': '0xd5fa2b00',
      'setAddr(bytes32,uint256,bytes)': '0x8b95dd71',
      'setContenthash(bytes32,bytes)': '0x304e6ade',
      'setDNSRecords(bytes32,bytes)': '0x0af179d7',
      'setInterface(bytes32,bytes4,address)': '0xe59d895d',
      'setName(bytes32,string)': '0x77372213',
      'setPubkey(bytes32,bytes32,bytes32)': '0x29cd62ea',
      'setText(bytes32,string,string)': '0x10f13a8c',
      'setZonehash(bytes32,bytes)': '0xce3decdc',
      'claim(address)': '0x1e83409a',
      'claimForAddr(address,address,address)': '0x65669631',
      'claimWithResolver(address,address)': '0x0f5a5466',
      'setName(string)': '0xc47f0027',
      'setNameForAddr(address,address,address,string)': '0x7a806d6b',
      'commit(bytes32)': '0xf14fcbc8',
      'register(string,address,uint256,bytes32,address,bytes[],bool,uint16)': '0x74694a2b',
      'register((string,address,uint256,bytes32,address,bytes[],uint8,bytes32))': '0xef9c8805',
      'renew(string,uint256)': '0xacf1a841',
      'renew(string,uint256,bytes32)': '0x18026ad1',
      'reclaim(uint256,address)': '0x28ed4f6c',
      'extendExpiry(bytes32,bytes32,uint64)': '0x6e5d6ad2',
      'setChildFuses(bytes32,bytes32,uint32,uint64)': '0x33c69ea9',
      'setFuses(bytes32,uint16)': '0x402906fc',
      'setSubnodeOwner(bytes32,string,address,uint32,uint64)': '0xc658e086',
      'setSubnodeRecord(bytes32,string,address,address,uint64,uint32,uint64)': '0x24c1af44',
      'unwrap(bytes32,bytes32,address)': '0xd8c9921a',
      'unwrapETH2LD(bytes32,address,address)': '0x8b4dfa75',
      'upgrade(bytes,bytes)': '0xc93ab3fd',
      'wrap(bytes,address,address)': '0xeb8ae530',
      'wrapETH2LD(string,address,uint16,address)': '0x8cf8b41e',
    }
    const ours = Object.fromEntries(
      ensAbi.map((f) => [toFunctionSignature(f), toFunctionSelector(f)] as const),
    )
    expect(ours).toEqual(verified)
  })

  it('decodes ENS calls a Safe made on Mainnet', () => {
    const tx = (to: `0x${string}`, data: `0x${string}`): SafeTx => ({
      to,
      value: 0n,
      data,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: 0n,
    })
    const eth = { symbol: 'ETH', decimals: 18 }
    const registry = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'
    // Nonce 39 of this Safe, tx 0x2d0e0f45…: a subname record on the registry
    const subnode = tx(
      registry,
      '0x5ef2c7f0fcd5690f4fbdba216fb9c72549465dcc97b176487a5bf77de88a6da8c866827a090bbec1dcebf36f7835888a48ea955a5055b4c3b087905f65d10d78c63b427c000000000000000000000000ee9eeaab0bb7d9b969d701f6f8212609edea252e000000000000000000000000f29100983e058b709f3d539b0c765937b804ac150000000000000000000000000000000000000000000000000000000000000000',
    )
    const d = decodeCalldata(subnode.data, std)
    expect(d.kind === 'abi' && d.source).toBe('ENS')
    expect(d.kind === 'abi' && d.args.map((a) => a.name)).toEqual([
      'node',
      'label',
      'owner',
      'resolver',
      'ttl',
    ])
    expect(describeCall(subnode, d, safe, eth)).toBe(
      'Create or update a subname, owned by this Safe',
    )
    // Nonce 35, tx 0x58877c29…: setResolver on the registry
    const resolver = tx(
      registry,
      '0x1896f70afcd5690f4fbdba216fb9c72549465dcc97b176487a5bf77de88a6da8c866827a00000000000000000000000037fa1af56b6cdd12d95d4f13ddf0dc8c39d0a12a',
    )
    expect(describeCall(resolver, decodeCalldata(resolver.data, std), safe, eth)).toBe(
      "Set a name's resolver to 0x37Fa…a12A",
    )
    // Nonce 52, tx 0x69185fb9…: a renewal through the 2025 .eth registrar controller
    const renew = tx(
      '0x59E16fcCd424Cc24e280Be16E11Bcd56fb0CE547',
      '0x18026ad10000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000967530000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011696e746567726174696f6e2d7465737473000000000000000000000000000000',
    )
    const r = decodeCalldata(renew.data, std)
    expect(r.kind === 'abi' && r.args.map((a) => a.value)).toEqual([
      'integration-tests',
      157766400n,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    ])
  })
})

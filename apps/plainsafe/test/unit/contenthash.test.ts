import { decodeFunctionData, parseAbi } from 'viem'
import { namehash } from 'viem/ens'
import { describe, expect, it } from 'vitest'
import { base32 } from '../../scripts/compute-cid'
import { contenthash, fromBase32, setContenthashCall } from '../../scripts/contenthash'

// The EIP-1577 example (ipfs://QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4), as a CIDv1
const CID = 'bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4'
const EXPECTED = '0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f'

describe('ENS contenthash for a release (SPEC §12)', () => {
  it('encodes an IPFS CIDv1 as EIP-1577 does', () => {
    expect(contenthash(CID)).toBe(EXPECTED)
    expect(base32(fromBase32(CID))).toBe(CID)
  })

  it('builds setContenthash(namehash(name), contenthash)', () => {
    const r = setContenthashCall('plainsafe.eth', CID)
    const d = decodeFunctionData({
      abi: parseAbi(['function setContenthash(bytes32 node, bytes hash)']),
      data: r.data,
    })
    expect(d.args).toEqual([namehash('plainsafe.eth'), EXPECTED])
  })

  it('refuses anything but a base32 CIDv1', () => {
    expect(() => contenthash('QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4')).toThrow()
  })
})

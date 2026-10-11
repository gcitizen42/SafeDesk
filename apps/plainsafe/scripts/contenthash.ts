// The ENS resolver call that points a name at a release (SPEC §12, P1): EIP-1577 contenthash for
// an IPFS CIDv1, and setContenthash(namehash(name), contenthash) calldata to paste into Plain
// Safe's contract-call builder (raw calldata, sent to the name's resolver).
//
// Run: bun run contenthash <name> <cid>    e.g. bun run contenthash plainsafe.eth bafybei…
import { bytesToHex, encodeFunctionData, type Hex, parseAbi } from 'viem'
import { namehash, normalize } from 'viem/ens'

const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'

/** Multibase base32 (`b…`, RFC 4648 lowercase, unpadded) to bytes. */
export function fromBase32(text: string): Uint8Array {
  if (!text.startsWith('b')) throw new Error('Expected a base32 CIDv1 (starting with "b")')
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of text.slice(1)) {
    const v = alphabet.indexOf(ch)
    if (v < 0) throw new Error(`Not base32: ${ch}`)
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

/** EIP-1577: the ipfs-ns multicodec (0xe3, as the varint e3 01) followed by the CID bytes. */
export function contenthash(cid: string): Hex {
  const bytes = fromBase32(cid)
  if (bytes[0] !== 0x01) throw new Error('Expected a CIDv1')
  return bytesToHex(Uint8Array.from([0xe3, 0x01, ...bytes]))
}

export function setContenthashCall(name: string, cid: string) {
  const node = namehash(normalize(name))
  const hash = contenthash(cid)
  return {
    node,
    contenthash: hash,
    data: encodeFunctionData({
      abi: parseAbi(['function setContenthash(bytes32 node, bytes hash)']),
      functionName: 'setContenthash',
      args: [node, hash],
    }),
  }
}

if (import.meta.main) {
  const [name, cid] = process.argv.slice(2)
  if (!name || !cid) throw new Error('Usage: bun run contenthash <name> <cid>')
  const r = setContenthashCall(name, cid)
  console.log(`name         ${name}
node         ${r.node}
contenthash  ${r.contenthash}
calldata     ${r.data}

In Plain Safe: New transaction → Contract call → the name's resolver → Raw calldata → the
calldata above. Check the review's decoded setContenthash(node, hash) against these values.`)
}

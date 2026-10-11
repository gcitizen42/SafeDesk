// MultiSend batches (SPEC §3.13, P1): the packed encoding of multiSend(bytes) and a strict decoder.
// Each entry is operation (1 byte) ‖ to (20) ‖ value (32) ‖ data length (32) ‖ data.
import {
  type Address,
  concat,
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  getAddress,
  type Hex,
  hexToBigInt,
  hexToNumber,
  parseAbi,
  size,
  slice,
} from 'viem'

export const multiSendAbi = parseAbi(['function multiSend(bytes transactions) payable'])

export interface BatchCall {
  readonly operation: 0 | 1
  readonly to: Address
  readonly value: bigint
  readonly data: Hex
}

/** Calldata for multiSend(bytes). MultiSendCallOnly rejects operation 1, so builders use 0. */
export function encodeMultiSend(calls: readonly BatchCall[]): Hex {
  const packed = concat(
    calls.map((c) =>
      encodePacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [c.operation, c.to, c.value, BigInt(size(c.data)), c.data],
      ),
    ),
  )
  return encodeFunctionData({ abi: multiSendAbi, functionName: 'multiSend', args: [packed] })
}

/**
 * The calls in multiSend(bytes) calldata, or undefined if it isn't exactly that: every byte must
 * belong to a well-formed entry.
 */
export function decodeMultiSend(data: Hex): BatchCall[] | undefined {
  let packed: Hex
  try {
    const d = decodeFunctionData({ abi: multiSendAbi, data })
    packed = d.args[0]
  } catch {
    return undefined
  }
  const total = size(packed)
  const calls: BatchCall[] = []
  let at = 0
  while (at < total) {
    if (at + 85 > total) return undefined
    const operation = hexToNumber(slice(packed, at, at + 1))
    if (operation !== 0 && operation !== 1) return undefined
    const to = getAddress(slice(packed, at + 1, at + 21))
    const value = hexToBigInt(slice(packed, at + 21, at + 53))
    const length = hexToBigInt(slice(packed, at + 53, at + 85))
    if (BigInt(at + 85) + length > BigInt(total)) return undefined
    const end = at + 85 + Number(length)
    const callData = length === 0n ? '0x' : slice(packed, at + 85, end)
    calls.push({ operation, to, value, data: callData })
    at = end
  }
  return calls.length ? calls : undefined
}

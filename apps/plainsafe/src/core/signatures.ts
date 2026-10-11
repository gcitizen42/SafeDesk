// Safe signature encoding (SPEC §5.2) and checks (SPEC §5.3).
import {
  type Address,
  concat,
  getAddress,
  type Hex,
  hashMessage,
  hexToNumber,
  isHex,
  numberToHex,
  pad,
  recoverAddress,
  size,
  slice,
} from 'viem'

type SignatureProblem = 'not-65-bytes' | 'bad-v'

/** Only plain EOA EIP-712 signatures are accepted (SPEC §5.2: no eth_sign, no EIP-1271). */
export function checkEip712SignatureBytes(data: Hex): SignatureProblem | undefined {
  if (!isHex(data) || size(data) !== 65) return 'not-65-bytes'
  const v = hexToNumber(slice(data, 64, 65))
  return v === 27 || v === 28 ? undefined : 'bad-v'
}

/** Some wallets return v as 0/1 (the recovery id). Safe expects 27/28. */
export function normalizeV(data: Hex): Hex {
  if (!isHex(data) || size(data) !== 65) return data
  const v = hexToNumber(slice(data, 64, 65))
  return v === 0 || v === 1 ? concat([slice(data, 0, 64), v === 0 ? '0x1b' : '0x1c']) : data
}

/** The address that signed `safeTxHash`, or undefined if the bytes aren't a valid signature. */
export async function recoverSigner(safeTxHash: Hex, data: Hex): Promise<Address | undefined> {
  if (checkEip712SignatureBytes(data)) return undefined
  try {
    return getAddress(await recoverAddress({ hash: safeTxHash, signature: data }))
  } catch {
    return undefined
  }
}

/** Pre-validated signature: r = owner, s = 0, v = 1. Valid when msg.sender is that owner. */
export function prevalidatedSignature(owner: Address): Hex {
  return concat([pad(owner, { size: 32 }), pad('0x', { size: 32 }), '0x01'])
}

/** Ascending order of signer address, the order checkNSignatures requires (SPEC §5.2). */
export const byAddress = (a: { signer: Address }, b: { signer: Address }) => {
  const x = BigInt(a.signer)
  const y = BigInt(b.signer)
  return x < y ? -1 : x > y ? 1 : 0
}

/** Concatenate signatures in `byAddress` order. Duplicate signers are dropped (first one wins). */
export function encodeSignatures(sigs: readonly { signer: Address; data: Hex }[]): Hex {
  const seen = new Set<string>()
  const unique = sigs.filter((s) => {
    const k = s.signer.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return unique.length ? concat(unique.sort(byAddress).map((s) => s.data)) : '0x'
}

// ---------- executed transactions (SPEC §11) ----------

export interface ExecutedSignature {
  /**
   * eip712: an EOA signed the safeTxHash; eth_sign: the same with the message prefix;
   * approved: the owner sent the transaction or called approveHash; contract: EIP-1271.
   */
  readonly kind: 'eip712' | 'eth_sign' | 'approved' | 'contract'
  /** The owner, or undefined when an ECDSA signature doesn't recover. */
  readonly signer?: Address
}

/**
 * The 65-byte static parts of the signatures an execution carried (r ‖ s ‖ v each). Contract
 * signatures point past the static parts to their dynamic data, which ends the list.
 */
export function signatureParts(signatures: Hex): { r: Hex; s: Hex; v: number }[] {
  if (!isHex(signatures)) return []
  let end = size(signatures)
  const parts: { r: Hex; s: Hex; v: number }[] = []
  for (let at = 0; at + 65 <= end; at += 65) {
    const r = slice(signatures, at, at + 32)
    const s = slice(signatures, at + 32, at + 64)
    const v = hexToNumber(slice(signatures, at + 64, at + 65))
    if (v === 0) {
      const offset = BigInt(s)
      if (offset < BigInt(at + 65)) break
      if (offset < BigInt(end)) end = Number(offset)
    }
    parts.push({ r, s, v })
  }
  return parts
}

const ownerFromWord = (word: Hex) => getAddress(slice(word, 12, 32))

export async function executedSigners(
  signatures: Hex,
  safeTxHash: Hex,
): Promise<ExecutedSignature[]> {
  return Promise.all(
    signatureParts(signatures).map(async ({ r, s, v }): Promise<ExecutedSignature> => {
      if (v === 0) return { kind: 'contract', signer: ownerFromWord(r) }
      if (v === 1) return { kind: 'approved', signer: ownerFromWord(r) }
      const ethSign = v > 30
      try {
        const signer = await recoverAddress({
          hash: ethSign ? hashMessage({ raw: safeTxHash }) : safeTxHash,
          signature: concat([r, s, numberToHex(ethSign ? v - 4 : v, { size: 1 })]),
        })
        return { kind: ethSign ? 'eth_sign' : 'eip712', signer: getAddress(signer) }
      } catch {
        return { kind: ethSign ? 'eth_sign' : 'eip712' }
      }
    }),
  )
}

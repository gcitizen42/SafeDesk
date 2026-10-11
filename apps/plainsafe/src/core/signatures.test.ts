import { concat, getAddress, type Hex, numberToHex, pad, size, slice } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { safeTxHashes, safeTxTypedData } from './safe-tx'
import {
  checkEip712SignatureBytes,
  encodeSignatures,
  executedSigners,
  normalizeV,
  prevalidatedSignature,
  recoverSigner,
  signatureParts,
} from './signatures'

const safe = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const tx = {
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 1n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: '0x0000000000000000000000000000000000000000',
  refundReceiver: '0x0000000000000000000000000000000000000000',
  nonce: 4n,
} as const

describe('signatures', () => {
  it('recovers the signer of an eth_signTypedData_v4 signature over the safeTxHash', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const sig = await account.signTypedData(safeTxTypedData(11155111, safe, tx))
    const { safeTx } = safeTxHashes(11155111, safe, tx)
    expect(checkEip712SignatureBytes(sig)).toBeUndefined()
    expect(await recoverSigner(safeTx, sig)).toBe(account.address)
    // A signature over a different transaction recovers someone else
    const other = safeTxHashes(11155111, safe, { ...tx, nonce: 5n }).safeTx
    expect(await recoverSigner(other, sig)).not.toBe(account.address)
  })

  it('rejects bytes that are not a 65-byte signature with v of 27 or 28', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const sig = await account.signTypedData(safeTxTypedData(1, safe, tx))
    const withV = (v: Hex) => concat([slice(sig, 0, 64), v])
    expect(checkEip712SignatureBytes('0x1234')).toBe('not-65-bytes')
    expect(checkEip712SignatureBytes(withV('0x01'))).toBe('bad-v') // pre-validated
    expect(checkEip712SignatureBytes(withV('0x00'))).toBe('bad-v') // EIP-1271
    expect(checkEip712SignatureBytes(withV('0x1f'))).toBe('bad-v') // eth_sign (v + 4)
    expect(await recoverSigner(safeTxHashes(1, safe, tx).safeTx, withV('0x1f'))).toBeUndefined()
  })

  it('normalizes v of 0/1 to 27/28', async () => {
    const account = privateKeyToAccount(generatePrivateKey())
    const sig = await account.signTypedData(safeTxTypedData(1, safe, tx))
    const v = Number.parseInt(sig.slice(-2), 16)
    const raw = concat([slice(sig, 0, 64), v === 27 ? '0x00' : '0x01'])
    expect(normalizeV(raw)).toBe(sig)
    expect(normalizeV(sig)).toBe(sig)
  })

  it('encodes a pre-validated signature as r = owner, s = 0, v = 1', () => {
    const owner = getAddress('0x00000000000000000000000000000000000000aa')
    expect(prevalidatedSignature(owner)).toBe(
      concat([pad(owner, { size: 32 }), `0x${'00'.repeat(32)}`, '0x01']),
    )
  })

  it('sorts by signer address ascending and drops duplicate signers', () => {
    const a = {
      signer: getAddress('0x2000000000000000000000000000000000000000'),
      data: '0xaa' as Hex,
    }
    const b = {
      signer: getAddress('0x1000000000000000000000000000000000000000'),
      data: '0xbb' as Hex,
    }
    const c = {
      signer: getAddress('0xf000000000000000000000000000000000000000'),
      data: '0xcc' as Hex,
    }
    expect(encodeSignatures([a, c, b])).toBe('0xbbaacc')
    expect(encodeSignatures([a, { ...a, data: '0xdd' }])).toBe('0xaa')
    expect(encodeSignatures([])).toBe('0x')
  })
})

describe('signatures of an executed transaction (SPEC §11)', () => {
  it('reads every kind, and stops at the dynamic part of a contract signature', async () => {
    const hash = safeTxHashes(1, safe, tx).safeTx
    const a = privateKeyToAccount(generatePrivateKey())
    const b = privateKeyToAccount(generatePrivateKey())
    const sender = privateKeyToAccount(generatePrivateKey()).address
    const wallet = '0x00000000000000000000000000000000000000Aa'
    const eip712 = await a.sign({ hash })
    // eth_sign: the prefixed message, v raised by 4
    const prefixed = await b.signMessage({ message: { raw: hash } })
    const ethSign = concat([
      slice(prefixed, 0, 64),
      numberToHex(Number(slice(prefixed, 64)) + 4, { size: 1 }),
    ])
    // A contract signature: r = the contract, s = where its data starts, v = 0
    const staticParts = 4
    const contract = concat([
      pad(wallet, { size: 32 }),
      numberToHex(staticParts * 65, { size: 32 }),
      '0x00',
    ])
    const dynamic = concat([
      numberToHex(3, { size: 32 }),
      pad('0xabcdef', { dir: 'right', size: 32 }),
    ])
    const all = concat([eip712, ethSign, prevalidatedSignature(sender), contract, dynamic])
    expect(signatureParts(all)).toHaveLength(4)
    expect(await executedSigners(all, hash)).toEqual([
      { kind: 'eip712', signer: a.address },
      { kind: 'eth_sign', signer: b.address },
      { kind: 'approved', signer: sender },
      { kind: 'contract', signer: getAddress(wallet) },
    ])
    expect(size(all)).toBeGreaterThan(4 * 65)
  })

  it('ignores trailing bytes that are not a whole signature', () => {
    expect(signatureParts('0x')).toEqual([])
    expect(signatureParts(`0x${'11'.repeat(64)}`)).toEqual([])
  })
})

import { Either } from 'effect'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { makePackage, verifyPackage } from './package'
import { safeTxHashes, safeTxTypedData } from './safe-tx'
import { normalizePersonalSignature, recoverSafeSignature, signatureMethod } from './signatures'

const safe = '0x1111111111111111111111111111111111111111' as const
const tx = {
  to: safe,
  value: 0n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: '0x0000000000000000000000000000000000000000',
  refundReceiver: '0x0000000000000000000000000000000000000000',
  nonce: 1n,
} as const
describe('SafeDesk signing choices', () => {
  it('verifies EIP-712 and prefixed Ledger hash signatures for the exact transaction', async () => {
    const owner = privateKeyToAccount(generatePrivateKey()),
      hash = safeTxHashes(1, safe, tx).safeTx
    const typed = await owner.signTypedData(safeTxTypedData(1, safe, tx))
    const personal = normalizePersonalSignature(await owner.signMessage({ message: { raw: hash } }))
    expect(signatureMethod(typed)).toBe('eip712')
    expect(signatureMethod(personal)).toBe('eth_sign')
    expect(await recoverSafeSignature(hash, typed, 'eip712')).toBe(owner.address)
    expect(await recoverSafeSignature(hash, personal, 'eth_sign')).toBe(owner.address)
    expect(await recoverSafeSignature(hash, personal, 'eip712')).toBeUndefined()
    expect(await recoverSafeSignature(hash, typed, 'eth_sign')).toBeUndefined()
    const pkg = makePackage({
      chainId: 1,
      safe,
      safeVersion: '1.3.0',
      tx,
      signatures: [{ signer: owner.address, kind: 'eth_sign', data: personal }],
    })
    const verified = await verifyPackage(pkg)
    expect(Either.isRight(verified) && verified.right.signatures[0]?.kind).toBe('eth_sign')
  })
  it('rejects mislabeled, unsupported and stale signatures without guessing a signing mode', async () => {
    const owner = privateKeyToAccount(generatePrivateKey()),
      hash = safeTxHashes(1, safe, tx).safeTx
    const personal = normalizePersonalSignature(await owner.signMessage({ message: { raw: hash } }))
    const pkg = makePackage({
      chainId: 1,
      safe,
      safeVersion: '1.3.0',
      tx,
      signatures: [{ signer: owner.address, kind: 'eip712', data: personal }],
    })
    const v = await verifyPackage(pkg)
    expect(Either.isRight(v) && v.right.signatures.length).toBe(0)
    expect(await recoverSafeSignature(hash, '0x1234')).toBeUndefined()
    expect(() => normalizePersonalSignature('0x1234')).toThrow()
    expect(
      await recoverSafeSignature(safeTxHashes(1, safe, { ...tx, nonce: 2n }).safeTx, personal),
    ).not.toBe(owner.address)
  })
})

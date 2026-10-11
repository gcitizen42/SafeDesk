import { Either } from 'effect'
import { type Address, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import {
  classifySigners,
  decodePayload,
  encodePayload,
  makePackage,
  mergeSignatures,
  packageFileName,
  parseShared,
  shareCode,
  shareLink,
  verifyPackage,
} from './package'
import { type SafeTx, safeTxTypedData } from './safe-tx'

const safe: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const tx: SafeTx = {
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 100000000000000000n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 4n,
}

async function signed(n = 1) {
  const accounts = Array.from({ length: n }, () => privateKeyToAccount(generatePrivateKey()))
  const signatures = await Promise.all(
    accounts.map(async (a) => ({
      signer: a.address,
      kind: 'eip712' as const,
      data: await a.signTypedData(safeTxTypedData(11155111, safe, tx)),
    })),
  )
  return {
    accounts,
    pkg: makePackage({
      chainId: 11155111,
      safe,
      safeVersion: '1.4.1',
      tx,
      signatures,
      note: 'Pay invoice',
    }),
  }
}

describe('package', () => {
  it('makes a package with the published safe-tx-hashes-util hashes and sorted signatures', async () => {
    const { pkg } = await signed(3)
    expect(pkg.hashes.safeTx).toBe(
      '0xcb8bbe7bf8f8a1f3f57658e450d07d4422356ac042d96a87ba425b19e67a78a1',
    )
    const signers = pkg.signatures.map((s) => BigInt(s.signer))
    expect(signers).toEqual([...signers].sort((a, b) => (a < b ? -1 : 1)))
    expect(pkg.tx.value).toBe('100000000000000000')
  })

  it('round-trips through JSON, the link payload and the plainsafe:1: code', async () => {
    const { pkg } = await signed(2)
    const payload = await encodePayload(pkg)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await decodePayload(payload)).toEqual(pkg)
    expect(await parseShared(shareCode(payload))).toEqual(pkg)
    expect(await parseShared(shareLink('https://plainsafe.eth.limo/#/safe/1/0x', payload))).toEqual(
      pkg,
    )
    expect(await parseShared(JSON.stringify(pkg, null, 2))).toEqual(pkg)
    const v = await verifyPackage(JSON.parse(JSON.stringify(pkg)))
    expect(Either.isRight(v)).toBe(true)
    if (Either.isRight(v)) {
      expect(v.right.signatures).toHaveLength(2)
      expect(v.right.tx).toEqual(tx)
    }
  })

  it('rejects the package when an included hash does not match the recomputed one', async () => {
    const { pkg } = await signed()
    const bad = { ...pkg, hashes: { ...pkg.hashes, safeTx: `0x${'11'.repeat(32)}` } }
    const v = await verifyPackage(bad)
    expect(Either.isLeft(v) && v.left._tag).toBe('HashMismatch')
  })

  it('rejects a package whose transaction was changed after hashing', async () => {
    const { pkg } = await signed()
    const v = await verifyPackage({
      ...pkg,
      tx: { ...pkg.tx, to: '0x0000000000000000000000000000000000000bad' },
    })
    expect(Either.isLeft(v) && v.left).toMatchObject({ _tag: 'HashMismatch', field: 'message' })
    const w = await verifyPackage({ ...pkg, chainId: 1 })
    expect(Either.isLeft(w) && w.left).toMatchObject({ _tag: 'HashMismatch', field: 'domain' })
  })

  it('rejects a signature that belongs to a different transaction, but keeps the package', async () => {
    const { pkg } = await signed(1)
    const other = privateKeyToAccount(generatePrivateKey())
    const wrong = await other.signTypedData(safeTxTypedData(11155111, safe, { ...tx, nonce: 5n }))
    const v = await verifyPackage({
      ...pkg,
      signatures: [...pkg.signatures, { signer: other.address, kind: 'eip712', data: wrong }],
    })
    expect(Either.isRight(v)).toBe(true)
    if (Either.isRight(v)) {
      expect(v.right.signatures).toHaveLength(1)
      expect(v.right.rejected).toEqual([
        { signer: other.address, reason: 'belongs to a different transaction or is corrupted' },
      ])
    }
  })

  it('rejects a signature claimed by someone else, and drops duplicates', async () => {
    const { pkg, accounts } = await signed(1)
    const sig = pkg.signatures[0]
    if (!sig) throw new Error('no signature')
    const impostor = privateKeyToAccount(generatePrivateKey()).address
    const v = await verifyPackage({ ...pkg, signatures: [sig, sig, { ...sig, signer: impostor }] })
    expect(Either.isRight(v) && v.right.signatures.map((s) => s.signer)).toEqual([
      accounts[0]?.address,
    ])
    expect(Either.isRight(v) && v.right.rejected.map((r) => r.signer)).toEqual([impostor])
  })

  it('rejects malformed input and unsupported versions', async () => {
    const { pkg } = await signed()
    for (const bad of [
      null,
      {},
      { ...pkg, type: 'other' },
      { ...pkg, tx: { ...pkg.tx, value: '-1' } },
      { ...pkg, tx: { ...pkg.tx, value: '01' } },
      { ...pkg, tx: { ...pkg.tx, operation: 2 } },
    ]) {
      const v = await verifyPackage(bad)
      expect(Either.isLeft(v) && v.left._tag).toBe('PackageDecodeError')
    }
    const old = await verifyPackage({ ...pkg, safeVersion: '1.2.0' })
    expect(Either.isLeft(old) && old.left._tag).toBe('PackageDecodeError')
    await expect(parseShared('hello')).rejects.toThrow()
  })

  it('refuses payloads that decompress beyond the size cap', async () => {
    const huge = new TextEncoder().encode(`"${'a'.repeat(3 * 1024 * 1024)}"`)
    const reader = new Blob([huge])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'))
      .getReader()
    const parts: Uint8Array[] = []
    for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value)
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) {
      bytes.set(p, o)
      o += p.length
    }
    const payload = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
    await expect(decodePayload(payload)).rejects.toThrow(/too large/)
  })

  it('merges signatures by signer and classifies owners', async () => {
    const a = await signed(1)
    const b = await signed(1)
    const merged = mergeSignatures(a.pkg.signatures, [...b.pkg.signatures, ...a.pkg.signatures])
    expect(merged).toHaveLength(2)
    const owner = a.accounts[0]?.address as Address
    const { owners, nonOwners } = classifySigners(merged, [owner])
    expect(owners.map((s) => s.signer)).toEqual([owner])
    expect(nonOwners).toHaveLength(1)
  })

  it('names files plainsafe-<safe-short>-n<nonce>-<safeTxHash-short>.json', async () => {
    const { pkg } = await signed()
    expect(packageFileName(pkg)).toBe('plainsafe-0x657f-n4-0xcb8bbe7b.json')
  })
})

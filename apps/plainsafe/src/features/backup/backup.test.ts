import { Effect, Either, Layer, Schema } from 'effect'
import { type Address, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { makePackage } from '@/core/package'
import { type SafeTx, safeTxTypedData } from '@/core/safe-tx'
import { defaultSettings } from '@/features/settings/defaults'
import { AddressBookEntry, addressBookKey } from '@/schemas/safes'
import { Settings } from '@/schemas/settings'
import { packageKey, StoredPackage } from '@/schemas/stored-package'
import { USER_DATA_STORES } from '@/storage/db'
import { makeStorage, memoryBackend, Storage } from '@/storage/service'
import { applyRestore, BACKUP_STORES, makeBackup, planRestore } from './backup'

function setup() {
  const backend = memoryBackend()
  const layer = Layer.succeed(Storage, makeStorage(backend))
  const run = <A, E>(eff: Effect.Effect<A, E, Storage>) =>
    Effect.runPromise(Effect.provide(eff, layer))
  return { backend, run }
}

const SAFE: Address = '0x657ff0D4eC65D82b2bC1247b0a558bcd2f80A0f1'
const tx: SafeTx = {
  to: '0x255C3912f91eF11bFDadd405F13144a823Da8cc5',
  value: 1n,
  data: '0x',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 3n,
}

// Throwaway keys only
async function signed(n: number) {
  const accounts = Array.from({ length: n }, () => privateKeyToAccount(generatePrivateKey()))
  return Promise.all(
    accounts.map(async (a) => ({
      signer: a.address,
      kind: 'eip712' as const,
      data: await a.signTypedData(safeTxTypedData(11155111, SAFE, tx)),
    })),
  )
}
const stored = (signatures: Awaited<ReturnType<typeof signed>>, note?: string): StoredPackage => ({
  package: makePackage({
    chainId: 11155111,
    safe: SAFE,
    safeVersion: '1.4.1',
    tx,
    signatures,
    note,
  }),
  updatedAt: '2026-09-25T00:00:00.000Z',
})

describe('Back up and Restore (SPEC §9.5)', () => {
  it('covers exactly the user-data stores', () => {
    expect(Object.keys(BACKUP_STORES).sort()).toEqual([...USER_DATA_STORES].sort())
  })

  it('round-trips user data into an empty database, leaving caches out', async () => {
    const a = setup()
    const [sig] = await signed(1)
    const pkg = stored(sig ? [sig] : [])
    const label = { chainId: '*' as const, address: SAFE, label: 'Team' }
    await a.run(
      Effect.gen(function* () {
        const s = yield* Storage
        yield* s.put('settings', 'settings', Settings, { ...defaultSettings, setupDone: true })
        yield* s.put('addressbook', addressBookKey('*', SAFE), AddressBookEntry, label)
        yield* s.put(
          'packages',
          packageKey(11155111, SAFE, pkg.package.hashes.safeTx),
          StoredPackage,
          pkg,
        )
      }),
    )
    await a.backend.put('cache_rpc_caps', 'https://rpc', { any: 1 })
    const { file, skipped } = await a.run(makeBackup)
    expect(skipped).toBe(0)
    expect(Object.keys(file.stores)).not.toContain('cache_rpc_caps')

    const plan = await planRestore(JSON.stringify(file))
    expect(Either.isRight(plan)).toBe(true)
    if (Either.isLeft(plan)) return
    expect(plan.right.counts).toMatchObject({
      settings: { valid: 1, invalid: 0 },
      addressbook: { valid: 1, invalid: 0 },
      packages: { valid: 1, invalid: 0 },
    })
    expect(plan.right.settings?.setupDone).toBe(true)

    const b = setup()
    await b.run(applyRestore(plan.right))
    const restored = await b.run(
      Effect.gen(function* () {
        const s = yield* Storage
        return {
          book: yield* s.getAll('addressbook', AddressBookEntry),
          packages: yield* s.getAll('packages', StoredPackage),
          settings: yield* s.getAll('settings', Settings),
        }
      }),
    )
    expect(restored.book.records.map((r) => r.value)).toEqual([label])
    expect(restored.packages.records[0]?.value.package.signatures).toEqual(pkg.package.signatures)
    expect(restored.settings.records[0]?.value.setupDone).toBe(true)
  })

  it('merges package signatures by safeTxHash instead of replacing them', async () => {
    const [x, y] = await signed(2)
    if (!x || !y) throw new Error('no signatures')
    const target = setup()
    const key = packageKey(11155111, SAFE, stored([x]).package.hashes.safeTx)
    await target.run(
      Effect.flatMap(Storage, (s) => s.put('packages', key, StoredPackage, stored([x]))),
    )
    const file = {
      type: 'plainsafe/backup',
      version: 1,
      createdAt: '2026-09-25T00:00:00.000Z',
      stores: { packages: [Schema.encodeSync(StoredPackage)(stored([y]))] },
    }
    const plan = await planRestore(JSON.stringify(file))
    if (Either.isLeft(plan)) throw new Error(plan.left)
    await target.run(applyRestore(plan.right))
    const after = await target.run(
      Effect.flatMap(Storage, (s) => s.getAll('packages', StoredPackage)),
    )
    expect(after.records[0]?.value.package.signatures.map((s) => s.signer).sort()).toEqual(
      [x.signer, y.signer].sort(),
    )
  })

  it('fills in a note only the backup has, and keeps the one already here', async () => {
    const restore = async (here: StoredPackage, backup: StoredPackage) => {
      const target = setup()
      const key = packageKey(11155111, SAFE, here.package.hashes.safeTx)
      await target.run(Effect.flatMap(Storage, (s) => s.put('packages', key, StoredPackage, here)))
      const plan = await planRestore(
        JSON.stringify({
          type: 'plainsafe/backup',
          version: 1,
          createdAt: '2026-09-25T00:00:00.000Z',
          stores: { packages: [Schema.encodeSync(StoredPackage)(backup)] },
        }),
      )
      if (Either.isLeft(plan)) throw new Error(plan.left)
      await target.run(applyRestore(plan.right))
      const after = await target.run(
        Effect.flatMap(Storage, (s) => s.getAll('packages', StoredPackage)),
      )
      return after.records[0]?.value.package.note
    }
    expect(await restore(stored([]), stored([], 'From the backup'))).toBe('From the backup')
    expect(await restore(stored([], 'Here'), stored([], 'From the backup'))).toBe('Here')
  })

  it('counts tampered and malformed records as invalid, and ignores unknown stores', async () => {
    const pkg = Schema.encodeSync(StoredPackage)(stored([]))
    const tampered = { ...pkg, package: { ...pkg.package, tx: { ...pkg.package.tx, value: '2' } } }
    const file = {
      type: 'plainsafe/backup',
      version: 1,
      createdAt: '2026-09-25T00:00:00.000Z',
      stores: {
        packages: [tampered],
        addressbook: [{ chainId: '*', address: 'nope', label: 'x' }],
        somethingNew: [{}],
      },
    }
    const plan = await planRestore(JSON.stringify(file))
    if (Either.isLeft(plan)) throw new Error(plan.left)
    expect(plan.right.counts).toEqual({
      packages: { valid: 0, invalid: 1 },
      addressbook: { valid: 0, invalid: 1 },
    })
    expect(plan.right.records).toEqual([])
    expect(plan.right.unknownStores).toEqual(['somethingNew'])
    expect(Either.isLeft(await planRestore('{"type":"other"}'))).toBe(true)
    expect(Either.isLeft(await planRestore('not json'))).toBe(true)
  })
})

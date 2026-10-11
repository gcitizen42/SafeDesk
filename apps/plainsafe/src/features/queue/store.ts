// Packages in IndexedDB (SPEC §3.9, §9.5). Stored packages are re-verified on every read: the
// schema decode happens in Storage, and hashes and signatures are recomputed here.
import { Data, Effect, Either, Option } from 'effect'
import type { Address, Hex } from 'viem'
import { mergeSignatures, type VerifiedPackage, verifyPackage } from '@/core/package'
import { InvalidRecord } from '@/effect/errors'
import {
  packageKey,
  StoredPackage,
  type StoredPackage as StoredPackageType,
} from '@/schemas/stored-package'
import { Storage } from '@/storage/service'

export class PackageNotFound extends Data.TaggedError('PackageNotFound')<{
  readonly safeTxHash: Hex
}> {}

interface LoadedPackage {
  readonly verified: VerifiedPackage
  readonly execution?: StoredPackageType['execution']
}

const reverify = (key: string, stored: StoredPackageType) =>
  Effect.gen(function* () {
    const v = yield* Effect.promise(() => verifyPackage(stored.package))
    if (Either.isLeft(v))
      return yield* new InvalidRecord({ store: 'packages', key, message: v.left._tag })
    return {
      verified: v.right,
      ...(stored.execution ? { execution: stored.execution } : {}),
    } satisfies LoadedPackage
  })

export const getPackage = (chainId: number, safe: Address, safeTxHash: Hex) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const key = packageKey(chainId, safe, safeTxHash)
    const stored = yield* storage.get('packages', key, StoredPackage)
    if (Option.isNone(stored)) return yield* new PackageNotFound({ safeTxHash })
    return yield* reverify(key, stored.value)
  })

/** All packages for one Safe; invalid ones are reported, never used. */
export const listPackages = (chainId: number, safe: Address) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const { records, invalid } = yield* storage.getAllWithPrefix(
      'packages',
      `${chainId}:${safe.toLowerCase()}:`,
      StoredPackage,
    )
    const packages: LoadedPackage[] = []
    const bad = [...invalid]
    for (const r of records) {
      const loaded = yield* Effect.either(reverify(r.key, r.value))
      if (loaded._tag === 'Right') packages.push(loaded.right)
      else bad.push(loaded.left)
    }
    return { packages, invalid: bad }
  })

/** Save a verified package, merging signatures with a stored one of the same safeTxHash. */
export const savePackage = (v: VerifiedPackage) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const key = packageKey(v.pkg.chainId, v.pkg.safe, v.hashes.safeTx)
    const existing = yield* Effect.either(storage.get('packages', key, StoredPackage))
    const prev = existing._tag === 'Right' ? Option.getOrUndefined(existing.right) : undefined
    const signatures = prev ? mergeSignatures(prev.package.signatures, v.signatures) : v.signatures
    const record: StoredPackageType = {
      package: {
        ...v.pkg,
        signatures,
        ...(prev?.package.note && !v.pkg.note ? { note: prev.package.note } : {}),
      },
      ...(prev?.execution ? { execution: prev.execution } : {}),
      updatedAt: new Date().toISOString(),
    }
    yield* storage.put('packages', key, StoredPackage, record)
    return { added: signatures.length - (prev?.package.signatures.length ?? 0), isNew: !prev }
  })

export const setExecution = (
  chainId: number,
  safe: Address,
  safeTxHash: Hex,
  execution: NonNullable<StoredPackageType['execution']>,
) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const key = packageKey(chainId, safe, safeTxHash)
    const stored = yield* storage.get('packages', key, StoredPackage)
    if (Option.isNone(stored)) return yield* new PackageNotFound({ safeTxHash })
    yield* storage.put('packages', key, StoredPackage, {
      ...stored.value,
      execution,
      updatedAt: new Date().toISOString(),
    })
  })

export const deletePackage = (chainId: number, safe: Address, safeTxHash: Hex) =>
  Effect.flatMap(Storage, (s) => s.remove('packages', packageKey(chainId, safe, safeTxHash)))

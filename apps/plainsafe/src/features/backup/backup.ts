// Back up and Restore (SPEC §9.5): the user-data stores as one JSON file. Restore decodes every
// record with its store's schema, re-verifies packages, recomputes each key from the record
// itself, then replaces settings and merges packages by safeTxHash.
import { Effect, Either, Option, ParseResult, Schema } from 'effect'
import { mergeSignatures, verifyPackage } from '@/core/package'
import { SETTINGS_KEY } from '@/features/settings/store'
import { AbiRecord, abiKey } from '@/schemas/abi'
import { UserDescriptorRecord } from '@/schemas/descriptor'
import { AddressBookEntry, addressBookKey, SafeRecord, safeKey } from '@/schemas/safes'
import { Settings } from '@/schemas/settings'
import { packageKey, StoredPackage } from '@/schemas/stored-package'
import { MyToken, myTokenKey, TokenListRecord } from '@/schemas/tokenlist'
import { USER_DATA_STORES } from '@/storage/db'
import { Storage } from '@/storage/service'

interface StoreDef<A, I> {
  readonly schema: Schema.Schema<A, I>
  readonly key: (value: A) => string
}
const def = <A, I>(schema: Schema.Schema<A, I>, key: (value: A) => string): StoreDef<A, I> => ({
  schema,
  key,
})

// Must list exactly the stores in USER_DATA_STORES (checked in backup.test.ts).
export const BACKUP_STORES = {
  settings: def(Settings, () => SETTINGS_KEY),
  safes: def(SafeRecord, (v) => safeKey(v.chainId, v.address)),
  recent: def(SafeRecord, (v) => safeKey(v.chainId, v.address)),
  packages: def(StoredPackage, (v) =>
    packageKey(v.package.chainId, v.package.safe, v.package.hashes.safeTx),
  ),
  tokenlists: def(TokenListRecord, (v) => v.id),
  mytokens: def(MyToken, (v) => myTokenKey(v.chainId, v.address)),
  addressbook: def(AddressBookEntry, (v) => addressBookKey(v.chainId, v.address)),
  descriptors: def(UserDescriptorRecord, (v) => v.id),
  abis: def(AbiRecord, (v) => abiKey(v.chainId, v.codeHash)),
} as const
type BackupStore = keyof typeof BACKUP_STORES
// biome-ignore lint/suspicious/noExplicitAny: each store has its own record type
const defOf = (store: BackupStore) => BACKUP_STORES[store] as StoreDef<any, any>
const isBackupStore = (name: string): name is BackupStore => name in BACKUP_STORES

const BackupFile = Schema.Struct({
  type: Schema.Literal('plainsafe/backup'),
  version: Schema.Literal(1),
  createdAt: Schema.String.pipe(Schema.maxLength(40)),
  stores: Schema.Record({
    key: Schema.String,
    value: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(100_000)),
  }),
})

/** Every valid user-data record, encoded for JSON. Invalid records are left out and counted. */
export const makeBackup = Effect.gen(function* () {
  const storage = yield* Storage
  const stores: Record<string, unknown[]> = {}
  let skipped = 0
  for (const name of USER_DATA_STORES) {
    if (!isBackupStore(name)) continue
    const { schema } = defOf(name)
    const { records, invalid } = yield* storage.getAll(name, schema)
    skipped += invalid.length
    stores[name] = records.map((r) => Schema.encodeSync(schema)(r.value))
  }
  const file = {
    type: 'plainsafe/backup' as const,
    version: 1 as const,
    createdAt: new Date().toISOString(),
    stores,
  }
  return { file, skipped }
})

export const backupFileName = (createdAt: string) =>
  `plainsafe-backup-${createdAt.slice(0, 10)}.json`

interface RestoreRecord {
  readonly store: BackupStore
  readonly key: string
  readonly value: unknown
}

export interface RestorePlan {
  readonly createdAt: string
  readonly counts: Readonly<Partial<Record<BackupStore, { valid: number; invalid: number }>>>
  readonly records: readonly RestoreRecord[]
  readonly settings?: Settings
  /** Store names in the file this version doesn't know; they are ignored. */
  readonly unknownStores: readonly string[]
}

/** Decode and check a backup file without writing anything. */
export async function planRestore(text: string): Promise<Either.Either<RestorePlan, string>> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return Either.left("This file isn't JSON.")
  }
  const file = Schema.decodeUnknownEither(BackupFile)(json)
  if (Either.isLeft(file))
    return Either.left(
      `This isn't a Plain Safe backup: ${ParseResult.TreeFormatter.formatErrorSync(file.left).split('\n')[0]}`,
    )
  const counts: Partial<Record<BackupStore, { valid: number; invalid: number }>> = {}
  const records: RestoreRecord[] = []
  let settings: Settings | undefined
  for (const [store, values] of Object.entries(file.right.stores)) {
    if (!isBackupStore(store)) continue
    const { schema, key } = defOf(store)
    const c = { valid: 0, invalid: 0 }
    for (const raw of values) {
      const decoded = Schema.decodeUnknownEither(schema)(raw)
      if (Either.isLeft(decoded)) {
        c.invalid++
        continue
      }
      let value = decoded.right
      if (store === 'packages') {
        // The same checks as an imported link: recomputed hashes, recovered signers
        const v = await verifyPackage((value as StoredPackage).package)
        if (Either.isLeft(v)) {
          c.invalid++
          continue
        }
        value = { ...(value as StoredPackage), package: v.right.pkg }
      }
      if (store === 'settings') {
        if (settings) {
          c.invalid++
          continue
        }
        settings = value as Settings
      }
      c.valid++
      records.push({ store, key: key(value), value })
    }
    counts[store] = c
  }
  return Either.right({
    createdAt: file.right.createdAt,
    counts,
    records,
    ...(settings ? { settings } : {}),
    unknownStores: Object.keys(file.right.stores).filter((n) => !isBackupStore(n)),
  })
}

/** Every signature from both copies; the note and execution seen here, else the backup's. */
function mergePackage(prev: StoredPackage, incoming: StoredPackage): StoredPackage {
  const note = prev.package.note ?? incoming.package.note
  const execution = prev.execution ?? incoming.execution
  return {
    package: {
      ...prev.package,
      signatures: mergeSignatures(prev.package.signatures, incoming.package.signatures),
      ...(note ? { note } : {}),
    },
    ...(execution ? { execution } : {}),
    updatedAt: new Date().toISOString(),
  }
}

/** Write a checked plan: settings are replaced, packages merged, everything else upserted. */
export const applyRestore = (plan: RestorePlan) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    for (const r of plan.records) {
      if (r.store === 'packages') {
        const incoming = r.value as StoredPackage
        const existing = yield* Effect.either(storage.get('packages', r.key, StoredPackage))
        const prev = Either.isRight(existing) ? Option.getOrUndefined(existing.right) : undefined
        const merged = prev ? mergePackage(prev, incoming) : incoming
        yield* storage.put('packages', r.key, StoredPackage, merged)
      } else {
        yield* storage.put(r.store, r.key, defOf(r.store).schema, r.value)
      }
    }
  })

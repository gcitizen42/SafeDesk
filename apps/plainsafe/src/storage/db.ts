// The only module that opens IndexedDB (SPEC §9.5). One database, one object store per domain.
import { type IDBPDatabase, type IDBPTransaction, openDB } from 'idb'

const DB_NAME = 'plainsafe'

// The stores migration v1 created. Frozen: later stores are added by later migrations.
const V1_STORES = [
  'settings',
  'safes',
  'recent',
  'packages',
  'tokenlists',
  'mytokens',
  'addressbook',
  'descriptors',
  'abis',
  'cache_rpc_caps',
  'cache_descriptors',
] as const

const STORES = [...V1_STORES, 'history_events', 'history_checkpoints'] as const
export type StoreName = (typeof STORES)[number]

/** Stores that hold user data, and so are included in Back up (SPEC §9.5). */
export const USER_DATA_STORES: readonly StoreName[] = [
  'settings',
  'safes',
  'recent',
  'packages',
  'tokenlists',
  'mytokens',
  'addressbook',
  'descriptors',
  'abis',
]

type Db = IDBPDatabase<unknown>
type UpgradeTx = IDBPTransaction<unknown, string[], 'versionchange'>

/**
 * Explicit migrations, one per database version. Never edit a shipped migration; add a new one.
 * Records use out-of-line keys such as `chainId:address` (SPEC §9.5 store table).
 */
const MIGRATIONS: ReadonlyArray<(db: Db, tx: UpgradeTx) => void> = [
  // v1: every store
  (db) => {
    for (const name of V1_STORES) db.createObjectStore(name)
  },
  // v2: onchain history, a rebuildable cache (SPEC §11)
  (db) => {
    db.createObjectStore('history_events')
    db.createObjectStore('history_checkpoints')
  },
]

const DB_VERSION = MIGRATIONS.length

let dbPromise: Promise<Db> | undefined

function openDatabase(): Promise<Db> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      for (let v = oldVersion; v < MIGRATIONS.length; v++) MIGRATIONS[v]?.(db, tx)
    },
    blocking() {
      // Another tab needs a newer version: close so it can upgrade, and reopen on next use.
      void dbPromise?.then((db) => db.close())
      dbPromise = undefined
    },
  }).catch((err: unknown) => {
    dbPromise = undefined
    throw err
  })
  return dbPromise
}

/** The raw key-value operations the Storage service is built on. */
export interface Backend {
  get(store: StoreName, key: string): Promise<unknown>
  getAll(store: StoreName): Promise<ReadonlyArray<{ key: string; value: unknown }>>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  clear(store: StoreName): Promise<void>
  /** Records whose key starts with `prefix`. */
  getPrefix(
    store: StoreName,
    prefix: string,
  ): Promise<ReadonlyArray<{ key: string; value: unknown }>>
  deletePrefix(store: StoreName, prefix: string): Promise<void>
  /** Several writes in one transaction: all of them happen, or none. */
  putMany(writes: ReadonlyArray<{ store: StoreName; key: string; value: unknown }>): Promise<void>
}

const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}\uffff`)

async function rows(store: StoreName, range?: IDBKeyRange) {
  const tx = (await openDatabase()).transaction(store, 'readonly')
  const out: { key: string; value: unknown }[] = []
  for await (const cursor of tx.store.iterate(range))
    out.push({ key: String(cursor.key), value: cursor.value })
  await tx.done
  return out
}

export const idbBackend: Backend = {
  async get(store, key) {
    return (await openDatabase()).get(store, key)
  },
  getAll: (store) => rows(store),
  async put(store, key, value) {
    await (await openDatabase()).put(store, value, key)
  },
  async delete(store, key) {
    await (await openDatabase()).delete(store, key)
  },
  async clear(store) {
    await (await openDatabase()).clear(store)
  },
  getPrefix: (store, prefix) => rows(store, prefixRange(prefix)),
  async deletePrefix(store, prefix) {
    await (await openDatabase()).delete(store, prefixRange(prefix))
  },
  async putMany(writes) {
    if (writes.length === 0) return
    const stores = [...new Set(writes.map((w) => w.store))]
    const tx = (await openDatabase()).transaction(stores, 'readwrite')
    await Promise.all([...writes.map((w) => tx.objectStore(w.store).put(w.value, w.key)), tx.done])
  },
}

/** Ask the browser not to evict our data under storage pressure (SPEC §9.5). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

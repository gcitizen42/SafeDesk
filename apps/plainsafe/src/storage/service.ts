// The Storage service (SPEC §9.5): every record is encoded with its schema on write and decoded
// on read. Invalid records are reported, never silently used.
import { Context, Effect, Layer, Option, ParseResult, Schema } from 'effect'
import { InvalidRecord, StorageError } from '@/effect/errors'
import { type Backend, idbBackend, type StoreName } from './db'

export interface Loaded<A> {
  readonly records: ReadonlyArray<{ readonly key: string; readonly value: A }>
  readonly invalid: ReadonlyArray<InvalidRecord>
}

export interface StorageApi {
  readonly get: <A, I>(
    store: StoreName,
    key: string,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<Option.Option<A>, StorageError | InvalidRecord>
  readonly getAll: <A, I>(
    store: StoreName,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<Loaded<A>, StorageError>
  readonly put: <A, I>(
    store: StoreName,
    key: string,
    schema: Schema.Schema<A, I>,
    value: A,
  ) => Effect.Effect<void, StorageError | InvalidRecord>
  readonly remove: (store: StoreName, key: string) => Effect.Effect<void, StorageError>
  readonly clear: (store: StoreName) => Effect.Effect<void, StorageError>
  readonly getAllWithPrefix: <A, I>(
    store: StoreName,
    prefix: string,
    schema: Schema.Schema<A, I>,
  ) => Effect.Effect<Loaded<A>, StorageError>
  readonly removePrefix: (store: StoreName, prefix: string) => Effect.Effect<void, StorageError>
  /** Several records, each encoded with its schema, written in one transaction. */
  readonly putMany: (
    writes: ReadonlyArray<Write<unknown, unknown>>,
  ) => Effect.Effect<void, StorageError | InvalidRecord>
}

export interface Write<A, I> {
  readonly store: StoreName
  readonly key: string
  readonly schema: Schema.Schema<A, I>
  readonly value: A
}

/** A typed write for putMany. */
export const write = <A, I>(
  store: StoreName,
  key: string,
  schema: Schema.Schema<A, I>,
  value: A,
): Write<unknown, unknown> => ({ store, key, schema, value }) as Write<unknown, unknown>

export class Storage extends Context.Tag('Storage')<Storage, StorageApi>() {}

const message = (e: ParseResult.ParseError) => ParseResult.TreeFormatter.formatErrorSync(e)

export function makeStorage(backend: Backend): StorageApi {
  const run = <T>(op: string, store: StoreName, f: () => Promise<T>) =>
    Effect.tryPromise({ try: f, catch: (cause) => new StorageError({ op, store, cause }) })

  const decode = <A, I>(store: StoreName, key: string, schema: Schema.Schema<A, I>, raw: unknown) =>
    Schema.decodeUnknown(schema)(raw).pipe(
      Effect.mapError((e) => new InvalidRecord({ store, key, message: message(e) })),
    )

  /** Decode each row; invalid ones are set aside and reported, never used (SPEC §9.5). */
  const decodeRows = <A, I>(
    store: StoreName,
    schema: Schema.Schema<A, I>,
    rows: Effect.Effect<ReadonlyArray<{ key: string; value: unknown }>, StorageError>,
  ) =>
    Effect.gen(function* () {
      const records: { key: string; value: A }[] = []
      const invalid: InvalidRecord[] = []
      for (const row of yield* rows) {
        const result = yield* Effect.either(decode(store, row.key, schema, row.value))
        if (result._tag === 'Right') records.push({ key: row.key, value: result.right })
        else invalid.push(result.left)
      }
      return { records, invalid } satisfies Loaded<A>
    })

  const encode = <A, I>(store: StoreName, key: string, schema: Schema.Schema<A, I>, value: A) =>
    Schema.encode(schema)(value).pipe(
      Effect.mapError((e) => new InvalidRecord({ store, key, message: message(e) })),
    )

  return {
    get: (store, key, schema) =>
      Effect.gen(function* () {
        const raw = yield* run('get', store, () => backend.get(store, key))
        if (raw === undefined) return Option.none()
        return Option.some(yield* decode(store, key, schema, raw))
      }),

    getAll: (store, schema) =>
      decodeRows(
        store,
        schema,
        run('getAll', store, () => backend.getAll(store)),
      ),

    getAllWithPrefix: (store, prefix, schema) =>
      decodeRows(
        store,
        schema,
        run('getPrefix', store, () => backend.getPrefix(store, prefix)),
      ),

    put: (store, key, schema, value) =>
      Effect.gen(function* () {
        const encoded = yield* encode(store, key, schema, value)
        yield* run('put', store, () => backend.put(store, key, encoded))
      }),

    putMany: (writes) =>
      Effect.gen(function* () {
        const encoded: { store: StoreName; key: string; value: unknown }[] = []
        for (const w of writes)
          encoded.push({
            store: w.store,
            key: w.key,
            value: yield* encode(w.store, w.key, w.schema, w.value),
          })
        yield* run('putMany', writes[0]?.store ?? 'settings', () => backend.putMany(encoded))
      }),

    remove: (store, key) => run('delete', store, () => backend.delete(store, key)),
    removePrefix: (store, prefix) =>
      run('deletePrefix', store, () => backend.deletePrefix(store, prefix)),
    clear: (store) => run('clear', store, () => backend.clear(store)),
  }
}

export const StorageLive = Layer.succeed(Storage, makeStorage(idbBackend))

/** An in-memory backend, for tests. */
export function memoryBackend(): Backend & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  const k = (store: string, key: string) => `${store}\u0000${key}`
  // Sorted by key, as IndexedDB returns them
  const rows = async (store: string, prefix: string) =>
    [...data.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .filter(([key]) => key.startsWith(k(store, prefix)))
      .map(([key, value]) => ({ key: key.slice(store.length + 1), value: structuredClone(value) }))
  const drop = async (store: string, prefix: string) => {
    for (const key of [...data.keys()]) if (key.startsWith(k(store, prefix))) data.delete(key)
  }
  return {
    data,
    get: async (store, key) => structuredClone(data.get(k(store, key))),
    getAll: (store) => rows(store, ''),
    put: async (store, key, value) => void data.set(k(store, key), structuredClone(value)),
    delete: async (store, key) => void data.delete(k(store, key)),
    clear: (store) => drop(store, ''),
    getPrefix: rows,
    deletePrefix: drop,
    putMany: async (writes) => {
      for (const w of writes) data.set(k(w.store, w.key), structuredClone(w.value))
    },
  }
}

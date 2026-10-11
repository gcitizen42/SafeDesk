// User-imported descriptors and the verified-download cache, through the Storage service (§9.5).
import type { Descriptor } from '@ethereum-sourcify/clear-signing'
import { Effect, Option } from 'effect'
import { run } from '@/effect/run'
import { CachedDescriptor, UserDescriptorRecord } from '@/schemas/descriptor'
import { Storage } from '@/storage/service'
import type { DescriptorCache, UserDescriptor } from './resolver'

export const listUserDescriptors = Effect.flatMap(Storage, (s) =>
  s.getAll('descriptors', UserDescriptorRecord),
).pipe(
  Effect.map(({ records, invalid }) => ({
    descriptors: records
      .map((r) => r.value)
      .sort((a, b) => a.importedAt.localeCompare(b.importedAt)),
    invalid,
  })),
)

export const saveUserDescriptor = (r: UserDescriptorRecord) =>
  Effect.flatMap(Storage, (s) => s.put('descriptors', r.id, UserDescriptorRecord, r))

export const removeUserDescriptor = (id: string) =>
  Effect.flatMap(Storage, (s) => s.remove('descriptors', id))

export const toUserDescriptor = (r: UserDescriptorRecord): UserDescriptor => ({
  id: r.id,
  name: r.name,
  // The schema checked the parts we rely on; the library validates the rest when it formats.
  descriptor: r.descriptor as unknown as Descriptor,
})

export const descriptorCache: DescriptorCache = {
  get: (sha256) =>
    run(
      Effect.flatMap(Storage, (s) => s.get('cache_descriptors', sha256, CachedDescriptor)).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.map((c) => c?.text),
        // An unreadable cache entry is just a miss; the file is fetched and checked again.
        Effect.orElseSucceed(() => undefined),
      ),
    ),
  put: (sha256, path, text) =>
    run(
      Effect.flatMap(Storage, (s) =>
        s.put('cache_descriptors', sha256, CachedDescriptor, { path, text }),
      ),
    ),
}

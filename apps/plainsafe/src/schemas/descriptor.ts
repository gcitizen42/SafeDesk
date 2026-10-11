// ERC-7730 descriptors in IndexedDB (SPEC §9.5): user-imported files, and the cache of registry
// files that passed their SHA-256 check.
import { Schema } from 'effect'
import { Address, ChainId } from './common'

const Rest = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const Sha256 = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/))

/**
 * The parts of an ERC-7730 file this app relies on (where it applies, and that it has formats).
 * Other keys are kept as they are; the library checks the rest when it formats.
 */
export const Erc7730Descriptor = Schema.Struct(
  {
    context: Schema.Struct(
      {
        contract: Schema.optional(
          Schema.Struct(
            {
              deployments: Schema.optional(
                Schema.Array(Schema.Struct({ chainId: ChainId, address: Address })),
              ),
            },
            Rest,
          ),
        ),
        eip712: Schema.optional(Rest),
      },
      Rest,
    ),
    display: Schema.Struct({ formats: Rest }, Rest),
  },
  Rest,
)

export const UserDescriptorRecord = Schema.Struct({
  /** SHA-256 of the imported file, also its key. */
  id: Sha256,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  importedAt: Schema.String.pipe(Schema.maxLength(40)),
  descriptor: Erc7730Descriptor,
})
export type UserDescriptorRecord = typeof UserDescriptorRecord.Type

/** A registry file, keyed by its SHA-256 and checked against it again on every read. */
export const CachedDescriptor = Schema.Struct({
  path: Schema.String.pipe(Schema.maxLength(300)),
  text: Schema.String.pipe(Schema.maxLength(2_000_000)),
})

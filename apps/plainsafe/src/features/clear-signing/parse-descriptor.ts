// Importing a user's ERC-7730 file (SPEC §7.2, §9.2: untrusted input is decoded with Schema).
import { Either, ParseResult, Schema } from 'effect'
import { Erc7730Descriptor, type UserDescriptorRecord } from '@/schemas/descriptor'
import { sha256Hex } from './resolver'

/** An imported ERC-7730 file, checked with Schema; its SHA-256 is its id (SPEC §9.5). */
export async function parseUserDescriptor(
  text: string,
  fileName?: string,
): Promise<Either.Either<UserDescriptorRecord, string>> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return Either.left("This file isn't JSON.")
  }
  // Own property only: a JSON array or string inherits an `includes` method
  if (json instanceof Object && Object.hasOwn(json, 'includes'))
    return Either.left(
      `This descriptor includes another file (${String((json as { includes: unknown }).includes).slice(0, 100)}), which can't be resolved here. Import a self-contained descriptor, with the included file merged in.`,
    )
  const d = Schema.decodeUnknownEither(Erc7730Descriptor)(json)
  if (Either.isLeft(d))
    return Either.left(
      `This isn't an ERC-7730 descriptor: ${ParseResult.TreeFormatter.formatErrorSync(d.left)}`,
    )
  const meta = (d.right as { metadata?: { owner?: unknown; contractName?: unknown } }).metadata
  const name =
    [meta?.contractName, meta?.owner, fileName].find(
      (x): x is string => typeof x === 'string' && x.trim().length > 0,
    ) ?? 'Imported descriptor'
  return Either.right({
    id: await sha256Hex(new TextEncoder().encode(text)),
    name: name.slice(0, 200),
    importedAt: new Date().toISOString(),
    descriptor: d.right,
  })
}

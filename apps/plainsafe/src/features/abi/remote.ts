// Opt-in ABI sources (SPEC §7.3, §8.2), each used only while its capability is on and sent
// through netguard with its own tag: Sourcify verified ABIs (level 3) and the signature
// database (level 4, guesses). Responses are untrusted and decoded with Schema.
import { Either, Schema } from 'effect'
import type { Address, Hex } from 'viem'
import { netguard } from '@/netguard'
import { type Abi, AbiItem } from '@/schemas/abi'

const SourcifyContract = Schema.Struct({
  abi: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(5000)),
  compilation: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.String.pipe(Schema.maxLength(200))) }),
  ),
})

export interface SourcifyAbi {
  readonly abi: Abi
  readonly name?: string
}

/** Items that don't decode are dropped one by one rather than rejecting the whole ABI. */
const decodeItems = (items: readonly unknown[]): Abi =>
  items.flatMap((item) => {
    const r = Schema.decodeUnknownEither(AbiItem)(item)
    return Either.isRight(r) ? [r.right] : []
  })

/** The verified ABI of a contract on Sourcify, or null when it isn't verified there. */
export async function fetchSourcifyAbi(
  chainId: number,
  address: Address,
): Promise<SourcifyAbi | null> {
  const res = await netguard.fetchFor('sourcify')(
    `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=abi,compilation.name`,
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`sourcify.dev answered HTTP ${res.status}`)
  const body = Schema.decodeUnknownEither(SourcifyContract)(await res.json())
  if (Either.isLeft(body)) throw new Error('sourcify.dev sent an answer in an unexpected shape')
  const name = body.right.compilation?.name
  return { abi: decodeItems(body.right.abi), ...(name ? { name } : {}) }
}

const Lookup = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.Struct({
    function: Schema.Record({
      key: Schema.String,
      value: Schema.NullOr(
        Schema.Array(
          Schema.Struct({
            name: Schema.String.pipe(Schema.maxLength(1000)),
            filtered: Schema.optional(Schema.Boolean),
          }),
        ).pipe(Schema.maxItems(100)),
      ),
    }),
  }),
})

/** Text signatures registered for a selector (unfiltered ones only). Anyone can register one. */
export async function lookupSignatures(selector: Hex): Promise<string[]> {
  const res = await netguard.fetchFor('signature-db')(
    `https://api.4byte.sourcify.dev/signature-database/v1/lookup?function=${selector}&filter=true`,
  )
  if (!res.ok) throw new Error(`api.4byte.sourcify.dev answered HTTP ${res.status}`)
  const body = Schema.decodeUnknownEither(Lookup)(await res.json())
  if (Either.isLeft(body) || !body.right.ok)
    throw new Error('api.4byte.sourcify.dev sent an answer in an unexpected shape')
  const found = body.right.result.function[selector.toLowerCase()] ?? []
  return found.filter((f) => !f.filtered).map((f) => f.name)
}

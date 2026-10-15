import { Either, Schema } from 'effect'
import { type Address, getAddress, type Hex } from 'viem'
import { parseSafeTx } from '@/core/builder-json'
import {
  makePackage,
  mergeSignatures,
  SUPPORTED_PACKAGE_VERSIONS,
  type VerifiedPackage,
} from '@/core/package'
import { safeTxHashes } from '@/core/safe-tx'
import { recoverSafeSignature, signatureMethod } from '@/core/signatures'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { Address as AddressSchema, ChainId } from '@/schemas/common'
import type { PackageSignature } from '@/schemas/package'
import { SafeTxPackage } from '@/schemas/package'
import type { StoredPackage } from '@/schemas/stored-package'

const Count = Schema.Int.pipe(Schema.between(0, Number.MAX_SAFE_INTEGER))
const CheckedAt = Schema.String.pipe(
  Schema.maxLength(40),
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/),
  Schema.filter((s) => Number.isFinite(Date.parse(s))),
)
const Envelope = Schema.Struct({
  chainId: ChainId,
  safe: AddressSchema,
  status: Schema.Literal('ok', 'partial', 'unsupported', 'unavailable'),
  complete: Schema.Boolean,
  checkedAt: CheckedAt,
  service: Schema.NullOr(Schema.String.pipe(Schema.maxLength(1000))),
  safeUrl: Schema.NullOr(Schema.String.pipe(Schema.maxLength(1000))),
  warning: Schema.optional(Schema.String.pipe(Schema.maxLength(1000))),
  rejected: Count,
  transactions: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(250)),
})
const Transaction = Schema.Struct({
  safeTxHash: SafeTxPackage.fields.hashes.fields.safeTx,
  tx: SafeTxPackage.fields.tx,
  confirmations: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(128)),
  reportedConfirmations: Count,
})
const Confirmation = Schema.Struct({
  owner: AddressSchema,
  signature: Schema.NullOr(Schema.String.pipe(Schema.maxLength(2 + 2 * 16 * 1024))),
})

export interface RejectedConfirmation {
  readonly owner?: Address
  readonly reason:
    | 'invalid-confirmation'
    | 'unsupported-signature'
    | 'wrong-owner-or-hash'
    | 'duplicate-owner'
    | 'signature-limit'
}

export interface PublishedTransaction {
  readonly verified: VerifiedPackage
  /** Service metadata only, never used to decide readiness. */
  readonly reportedConfirmations: number
  readonly rejectedConfirmations: readonly RejectedConfirmation[]
}

export interface PublishedQueue {
  readonly status: 'ok' | 'partial' | 'unsupported' | 'unavailable'
  readonly complete: boolean
  readonly checkedAt: string | null
  readonly service: string | null
  readonly safeUrl: string | null
  readonly warning?: string
  /** Rows rejected by the backend. */
  readonly rejected: number
  readonly invalid: readonly {
    readonly safeTxHash?: Hex
    readonly reason: 'invalid-response' | 'invalid-transaction' | 'hash-mismatch' | 'stale-nonce'
  }[]
  readonly transactions: readonly PublishedTransaction[]
}

export interface QueuePackage {
  readonly verified: VerifiedPackage
  readonly execution?: StoredPackage['execution']
  readonly local: boolean
  readonly published?: PublishedTransaction
}

/** VERSION() is informational: only the matched runtime code supplies a package version. */
export function publishedSnapshot(
  chainId: number,
  safe: Address,
  snapshot: SafeSnapshot | undefined,
): SafeSnapshot | undefined {
  return snapshot?.chainId === chainId &&
    snapshot.address.toLowerCase() === safe.toLowerCase() &&
    snapshot.nonce !== undefined &&
    snapshot.nonce >= 0n &&
    snapshot.authenticity.status === 'verified' &&
    SUPPORTED_PACKAGE_VERSIONS.has(snapshot.authenticity.version)
    ? snapshot
    : undefined
}

const SAFE_PREFIX: Readonly<Record<number, string>> = {
  1: 'eth',
  10: 'oeth',
  56: 'bnb',
  100: 'gno',
  137: 'matic',
  42161: 'arb1',
  43114: 'avax',
  8453: 'base',
  11155111: 'sep',
  60808: 'bob',
}

/** Construct, rather than trust, a service-provided navigation URL. Unknown chains get no link. */
export function publishedSafeUrl(chainId: number, safe: Address): string | null {
  const prefix = SAFE_PREFIX[chainId]
  const origin = chainId === 60808 ? 'https://safe.gobob.xyz' : 'https://app.safe.global'
  return prefix ? `${origin}/transactions/queue?safe=${prefix}:${getAddress(safe)}` : null
}

const unknownQueue = (): PublishedQueue => ({
  status: 'unavailable',
  complete: false,
  checkedAt: null,
  service: null,
  safeUrl: null,
  rejected: 0,
  invalid: [{ reason: 'invalid-response' }],
  transactions: [],
})

export function publishedQueueComplete(queue: PublishedQueue | undefined): boolean {
  return (
    queue?.status === 'ok' && queue.complete && queue.rejected === 0 && queue.invalid.length === 0
  )
}

/** Validate the envelope and every full SafeTx before accepting any EOA confirmation. No I/O. */
export async function parsePublishedQueue(
  input: unknown,
  snapshot: SafeSnapshot,
): Promise<PublishedQueue> {
  if (!publishedSnapshot(snapshot.chainId, snapshot.address, snapshot)) return unknownQueue()
  const envelope = Schema.decodeUnknownEither(Envelope)(input)
  if (
    Either.isLeft(envelope) ||
    envelope.right.chainId !== snapshot.chainId ||
    envelope.right.safe.toLowerCase() !== snapshot.address.toLowerCase() ||
    snapshot.authenticity.status !== 'verified'
  )
    return unknownQueue()

  const dto = envelope.right
  const result = {
    checkedAt: dto.checkedAt,
    service: dto.service,
    safeUrl: publishedSafeUrl(snapshot.chainId, snapshot.address),
    ...(dto.warning ? { warning: dto.warning } : {}),
    rejected: dto.rejected,
  }
  if (dto.status === 'unsupported' || dto.status === 'unavailable')
    return { ...result, status: dto.status, complete: false, invalid: [], transactions: [] }

  const invalid: PublishedQueue['invalid'][number][] = []
  const transactions: PublishedTransaction[] = []
  for (const inputRow of dto.transactions) {
    const decoded = Schema.decodeUnknownEither(Transaction)(inputRow)
    if (Either.isLeft(decoded)) {
      invalid.push({ reason: 'invalid-transaction' })
      continue
    }
    const row = decoded.right
    try {
      const tx = parseSafeTx(row.tx)
      const hashes = safeTxHashes(snapshot.chainId, snapshot.address, tx)
      if (hashes.safeTx.toLowerCase() !== row.safeTxHash.toLowerCase()) {
        invalid.push({ safeTxHash: row.safeTxHash, reason: 'hash-mismatch' })
        continue
      }
      if (tx.nonce < (snapshot.nonce as bigint)) {
        invalid.push({ safeTxHash: row.safeTxHash, reason: 'stale-nonce' })
        continue
      }
      const signatures: PackageSignature[] = []
      const rejectedConfirmations: RejectedConfirmation[] = []
      const seen = new Set<string>()
      for (const inputConfirmation of row.confirmations) {
        const confirmation = Schema.decodeUnknownEither(Confirmation)(inputConfirmation)
        if (Either.isLeft(confirmation)) {
          rejectedConfirmations.push({ reason: 'invalid-confirmation' })
          continue
        }
        const { owner: rawOwner, signature } = confirmation.right
        const owner = getAddress(rawOwner)
        // Reject v=0/1 (contract/approved-hash), null, and non-65-byte data outright.
        const kind =
          signature && /^0x[0-9a-fA-F]{130}$/.test(signature)
            ? signatureMethod(signature as Hex)
            : undefined
        if (!kind || !signature) {
          rejectedConfirmations.push({ owner, reason: 'unsupported-signature' })
          continue
        }
        const data = signature.toLowerCase() as Hex
        const recovered = await recoverSafeSignature(hashes.safeTx, data, kind)
        if (recovered?.toLowerCase() !== owner.toLowerCase()) {
          rejectedConfirmations.push({ owner, reason: 'wrong-owner-or-hash' })
          continue
        }
        if (seen.has(owner.toLowerCase())) {
          rejectedConfirmations.push({ owner, reason: 'duplicate-owner' })
          continue
        }
        seen.add(owner.toLowerCase())
        // Package v1 admits at most 100 signatures, even when the service returns more.
        if (signatures.length === 100) {
          rejectedConfirmations.push({ owner, reason: 'signature-limit' })
          continue
        }
        signatures.push({ signer: owner, kind, data })
      }
      const pkg = makePackage({
        chainId: snapshot.chainId,
        safe: snapshot.address,
        safeVersion: snapshot.authenticity.version,
        tx,
        signatures,
        createdAt: dto.checkedAt,
      })
      transactions.push({
        verified: { pkg, tx, hashes, signatures: pkg.signatures, rejected: [] },
        reportedConfirmations: row.reportedConfirmations,
        rejectedConfirmations,
      })
    } catch {
      invalid.push({ safeTxHash: row.safeTxHash, reason: 'invalid-transaction' })
    }
  }
  const complete = dto.status === 'ok' && dto.complete && dto.rejected === 0 && invalid.length === 0
  return { ...result, status: complete ? 'ok' : 'partial', complete, invalid, transactions }
}

/** Hash-only union in memory. The local package's note, timestamps and execution always win. */
export function mergePublishedPackages(
  local: readonly {
    readonly verified: VerifiedPackage
    readonly execution?: StoredPackage['execution']
  }[],
  published: readonly PublishedTransaction[],
): QueuePackage[] {
  const rows = new Map<string, QueuePackage>()
  for (const p of local) rows.set(p.verified.hashes.safeTx.toLowerCase(), { ...p, local: true })
  for (const p of published) {
    const key = p.verified.hashes.safeTx.toLowerCase()
    const existing = rows.get(key)
    if (!existing) {
      rows.set(key, { verified: p.verified, local: false, published: p })
      continue
    }
    const signatures = mergeSignatures(existing.verified.signatures, p.verified.signatures)
    const verified = {
      ...existing.verified,
      pkg: { ...existing.verified.pkg, signatures },
      signatures,
    }
    rows.set(key, {
      ...existing,
      verified,
      published: {
        ...p,
        verified,
        reportedConfirmations: Math.max(
          existing.published?.reportedConfirmations ?? 0,
          p.reportedConfirmations,
        ),
        rejectedConfirmations: [
          ...(existing.published?.rejectedConfirmations ?? []),
          ...p.rejectedConfirmations,
        ],
      },
    })
  }
  return [...rows.values()]
}

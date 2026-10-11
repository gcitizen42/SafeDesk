// Package codec and verification (SPEC §3.6, §3.7, §5.3, §6). Pure; runs before any network
// request, so a co-signer sees the recomputed hashes offline.
import { Either, ParseResult, Schema } from 'effect'
import { type Address, getAddress, type Hex } from 'viem'
import { type PackageSignature, SafeTxPackage } from '@/schemas/package'
import { type SafeTx, type SafeTxHashes, safeTxHashes } from './safe-tx'
import { byAddress, recoverSigner } from './signatures'

export const SUPPORTED_PACKAGE_VERSIONS = new Set(['1.3.0', '1.4.1', '1.5.0'])

// ---------- conversions ----------

function packageTx(pkg: SafeTxPackage): SafeTx {
  const t = pkg.tx
  return {
    to: getAddress(t.to),
    value: BigInt(t.value),
    data: t.data.toLowerCase() as Hex,
    operation: t.operation,
    safeTxGas: BigInt(t.safeTxGas),
    baseGas: BigInt(t.baseGas),
    gasPrice: BigInt(t.gasPrice),
    gasToken: getAddress(t.gasToken),
    refundReceiver: getAddress(t.refundReceiver),
    nonce: BigInt(t.nonce),
  }
}

export function makePackage(args: {
  chainId: number
  safe: Address
  safeVersion: string
  tx: SafeTx
  signatures?: readonly PackageSignature[]
  note?: string | undefined
  createdAt?: string
}): SafeTxPackage {
  const { tx } = args
  const hashes = safeTxHashes(args.chainId, args.safe, tx)
  return {
    type: 'plainsafe/safe-tx',
    version: 1,
    chainId: args.chainId,
    safe: getAddress(args.safe),
    safeVersion: args.safeVersion,
    tx: {
      to: getAddress(tx.to),
      value: tx.value.toString(),
      data: tx.data,
      operation: tx.operation,
      safeTxGas: tx.safeTxGas.toString(),
      baseGas: tx.baseGas.toString(),
      gasPrice: tx.gasPrice.toString(),
      gasToken: getAddress(tx.gasToken),
      refundReceiver: getAddress(tx.refundReceiver),
      nonce: tx.nonce.toString(),
    },
    hashes: { domain: hashes.domain, message: hashes.message, safeTx: hashes.safeTx },
    signatures: sortSignatures(args.signatures ?? []),
    ...(args.note ? { note: args.note } : {}),
    createdAt: args.createdAt ?? new Date().toISOString(),
  }
}

const sortSignatures = (sigs: readonly PackageSignature[]) => [...sigs].sort(byAddress)

/** Merge signatures by signer (SPEC §3.9); an existing one wins. */
export function mergeSignatures(
  a: readonly PackageSignature[],
  b: readonly PackageSignature[],
): PackageSignature[] {
  const out = new Map<string, PackageSignature>()
  for (const s of [...a, ...b])
    if (!out.has(s.signer.toLowerCase())) out.set(s.signer.toLowerCase(), s)
  return sortSignatures([...out.values()])
}

// ---------- verification ----------

export type PackageProblem =
  | { readonly _tag: 'PackageDecodeError'; readonly message: string }
  | {
      readonly _tag: 'HashMismatch'
      readonly field: 'domain' | 'message' | 'safeTx'
      readonly claimed: Hex
      readonly computed: Hex
    }

export interface RejectedSignature {
  readonly signer: Address
  readonly reason: string
}

export interface VerifiedPackage {
  readonly pkg: SafeTxPackage
  readonly tx: SafeTx
  readonly hashes: SafeTxHashes
  /** Signatures whose recovered signer matches the claimed signer, deduplicated. */
  readonly signatures: readonly PackageSignature[]
  readonly rejected: readonly RejectedSignature[]
}

/** Decode, recompute all three hashes, and recover every signer. */
export async function verifyPackage(
  input: unknown,
): Promise<Either.Either<VerifiedPackage, PackageProblem>> {
  const decoded = Schema.decodeUnknownEither(SafeTxPackage)(input)
  if (Either.isLeft(decoded)) {
    return Either.left({
      _tag: 'PackageDecodeError',
      message: ParseResult.TreeFormatter.formatErrorSync(decoded.left),
    })
  }
  const pkg = decoded.right
  if (!SUPPORTED_PACKAGE_VERSIONS.has(pkg.safeVersion)) {
    return Either.left({
      _tag: 'PackageDecodeError',
      message: `Safe version ${pkg.safeVersion} is not supported (v1.3.0 or later).`,
    })
  }
  const tx = packageTx(pkg)
  const hashes = safeTxHashes(pkg.chainId, getAddress(pkg.safe), tx)
  for (const field of ['domain', 'message', 'safeTx'] as const) {
    if (pkg.hashes[field].toLowerCase() !== hashes[field].toLowerCase()) {
      return Either.left({
        _tag: 'HashMismatch',
        field,
        claimed: pkg.hashes[field],
        computed: hashes[field],
      })
    }
  }
  const signatures: PackageSignature[] = []
  const rejected: RejectedSignature[] = []
  const seen = new Set<string>()
  for (const s of pkg.signatures) {
    const signer = getAddress(s.signer)
    if (seen.has(signer)) continue // duplicates are dropped (SPEC §5.3)
    const recovered = await recoverSigner(hashes.safeTx, s.data)
    if (recovered !== signer) {
      rejected.push({ signer, reason: 'belongs to a different transaction or is corrupted' })
      continue
    }
    seen.add(signer)
    signatures.push({ signer, kind: 'eip712', data: s.data.toLowerCase() as Hex })
  }
  return Either.right({ pkg: { ...pkg, signatures }, tx, hashes, signatures, rejected })
}

/** SPEC §5.3 step 2: split verified signatures by whether the signer is a current owner. */
export function classifySigners(
  signatures: readonly PackageSignature[],
  owners: readonly Address[] | undefined,
) {
  const set = new Set(owners?.map((o) => o.toLowerCase()))
  return {
    owners: signatures.filter((s) => set.has(s.signer.toLowerCase())),
    nonOwners: signatures.filter((s) => !set.has(s.signer.toLowerCase())),
  }
}

// ---------- transport encodings ----------

const base64url = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  },
  decode(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url')
    const b64 = text.replaceAll('-', '+').replaceAll('_', '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  },
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error('Payload too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

/** Decompressed payloads are capped, so a crafted link can't exhaust memory. */
const MAX_JSON_BYTES = 2 * 1024 * 1024

/** base64url(deflate-raw(JSON)), for the link fragment and the plainsafe:1: code (SPEC §3.6). */
export async function encodePayload(pkg: SafeTxPackage): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(pkg))
  return base64url.encode(
    await pipe(json, new CompressionStream('deflate-raw'), Number.POSITIVE_INFINITY),
  )
}

export async function decodePayload(payload: string): Promise<unknown> {
  const bytes = await pipe(
    base64url.decode(payload),
    new DecompressionStream('deflate-raw'),
    MAX_JSON_BYTES,
  )
  return JSON.parse(new TextDecoder().decode(bytes))
}

const CODE_PREFIX = 'plainsafe:1:'
export const shareCode = (payload: string) => `${CODE_PREFIX}${payload}`
/** The link keeps everything after `#`, which is never sent to a server or gateway. */
export const shareLink = (appUrl: string, payload: string) =>
  `${appUrl.split('#')[0]}#/import/${payload}`

/** Accepts a full link, a plainsafe:1: code, or raw JSON (SPEC §3.7). */
export async function parseShared(text: string): Promise<unknown> {
  const t = text.trim()
  if (t.startsWith('{')) return JSON.parse(t)
  if (t.startsWith(CODE_PREFIX)) return decodePayload(t.slice(CODE_PREFIX.length))
  const i = t.indexOf('#/import/')
  if (i >= 0) return decodePayload(t.slice(i + '#/import/'.length).split(/[?#]/)[0] ?? '')
  throw new Error('Paste a Plain Safe link, a plainsafe:1: code, or the JSON of a package.')
}

/** plainsafe-<safe-short>-n<nonce>-<safeTxHash-short>.json (SPEC §3.6). */
export const packageFileName = (pkg: SafeTxPackage) =>
  `plainsafe-${pkg.safe.slice(0, 6).toLowerCase()}-n${pkg.tx.nonce}-${pkg.hashes.safeTx.slice(0, 10).toLowerCase()}.json`

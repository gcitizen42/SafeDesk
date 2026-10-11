// Computes the IPFS CID of a build directory locally (SPEC §12), with the UnixFS settings omnipin
// pins, so a release's CID can be checked against what omnipin uploads. No dependencies: the
// encoding is written out here, and RELEASE.md records the settings.
//
//   CIDv1, sha2-256; raw leaves; fixed-size chunker, 262,144 bytes; balanced layout, 174 links
//   per node; a single-chunk file is its raw leaf; files wrapped in one root directory; plain
//   (unsharded) directories; no mode or mtime; dotfiles left out.
//
// Run: bun run cid [dir]   (default: dist)
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SETTINGS = {
  chunkSize: 262_144,
  maxLinksPerNode: 174,
  /** omnipin shards a directory whose links exceed this; we refuse instead. */
  shardThresholdBytes: 262_144,
} as const

const RAW = 0x55
const DAG_PB = 0x70
const SHA2_256 = 0x12

function varint(n: number | bigint): number[] {
  let v = BigInt(n)
  const out: number[] = []
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n))
    v >>= 7n
  }
  out.push(Number(v))
  return out
}

const concat = (parts: readonly (Uint8Array | number[])[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A protobuf length-delimited field. */
const field = (tag: number, bytes: Uint8Array) => concat([[tag], varint(bytes.length), bytes])

function cid(codec: number, block: Uint8Array): Uint8Array {
  const digest = createHash('sha256').update(block).digest()
  return concat([varint(1), varint(codec), [SHA2_256], varint(digest.length), digest])
}

/** Multibase base32 (RFC 4648, lowercase, unpadded) with its `b` prefix. */
export function base32(bytes: Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  let out = 'b'
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

interface Link {
  readonly hash: Uint8Array
  readonly name: string
  readonly tsize: number
}

/** dag-pb: links (sorted by name bytes, stable) before data. */
function dagPb(links: readonly Link[], data: Uint8Array): Uint8Array {
  const sorted = [...links].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
  return concat([
    ...sorted.map((l) =>
      field(
        0x12,
        concat([
          field(0x0a, l.hash),
          field(0x12, new TextEncoder().encode(l.name)),
          [0x18],
          varint(l.tsize),
        ]),
      ),
    ),
    field(0x0a, data),
  ])
}

/** UnixFS Data for a file node: Type=File, filesize, then each child's size (unpacked). */
const unixfsFile = (blockSizes: readonly bigint[]) =>
  concat([
    [0x08, 0x02],
    [0x18],
    varint(blockSizes.reduce((a, b) => a + b, 0n)),
    ...blockSizes.flatMap((s) => [[0x20], varint(s)]),
  ])

/** UnixFS Data for a directory: Type=Directory. */
const UNIXFS_DIR = new Uint8Array([0x08, 0x01])

interface Built {
  readonly cid: Uint8Array
  /** Tsize: the whole DAG under this node. */
  readonly size: number
  /** Bytes of file content under this node. */
  readonly fileSize: bigint
}

function fileDag(content: Uint8Array): Built {
  const leaves: Built[] = []
  for (let at = 0; at < content.length || leaves.length === 0; at += SETTINGS.chunkSize) {
    const chunk = content.subarray(at, at + SETTINGS.chunkSize)
    leaves.push({ cid: cid(RAW, chunk), size: chunk.length, fileSize: BigInt(chunk.length) })
  }
  const [only] = leaves
  if (leaves.length === 1 && only) return only
  let level = leaves
  while (level.length > 1) {
    const next: Built[] = []
    for (let i = 0; i < level.length; i += SETTINGS.maxLinksPerNode) {
      const group = level.slice(i, i + SETTINGS.maxLinksPerNode)
      const block = dagPb(
        group.map((n) => ({ hash: n.cid, name: '', tsize: n.size })),
        unixfsFile(group.map((n) => n.fileSize)),
      )
      next.push({
        cid: cid(DAG_PB, block),
        size: block.length + group.reduce((a, n) => a + n.size, 0),
        fileSize: group.reduce((a, n) => a + n.fileSize, 0n),
      })
    }
    level = next
  }
  return level[0] as Built
}

function directoryDag(dir: string): Built {
  const links: Link[] = []
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    const path = join(dir, name)
    const isDir = statSync(path).isDirectory()
    // A directory with no files isn't imported
    if (isDir && isEmptyTree(path)) continue
    const child = isDir ? directoryDag(path) : fileDag(readFileSync(path))
    links.push({ hash: child.cid, name, tsize: child.size })
  }
  const block = dagPb(links, UNIXFS_DIR)
  if (block.length > SETTINGS.shardThresholdBytes)
    throw new Error(`${dir} has too many entries for an unsharded directory`)
  return {
    cid: cid(DAG_PB, block),
    size: block.length + links.reduce((a, l) => a + l.tsize, 0),
    fileSize: 0n,
  }
}

function isEmptyTree(dir: string): boolean {
  return readdirSync(dir).every((n) => {
    const p = join(dir, n)
    return n.startsWith('.') || (statSync(p).isDirectory() && isEmptyTree(p))
  })
}

export const computeCid = (dir: string) => base32(directoryDag(dir).cid)

if (import.meta.main) {
  const dir = process.argv[2] ?? 'dist'
  console.log(computeCid(dir))
}

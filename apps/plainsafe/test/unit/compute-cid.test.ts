// scripts/compute-cid.ts against CIDs from omnipin 3.1.3 (`omnipin pack <dir> --only-hash`) for
// the same deterministic inputs (SPEC §12: a release's CID must match omnipin's).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { base32, computeCid } from '../../scripts/compute-cid'

const root = mkdtempSync(join(tmpdir(), 'plainsafe-cid-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Empty and one-byte files, chunk-size boundaries, 175+ chunks, nesting, Unicode, a dotfile. */
function fixture(dir: string) {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 251)
  mkdirSync(join(dir, 'a/b/c'), { recursive: true })
  mkdirSync(join(dir, 'empty-dir/inner'), { recursive: true })
  writeFileSync(join(dir, 'empty.txt'), '')
  writeFileSync(join(dir, 'one.txt'), 'x')
  writeFileSync(join(dir, 'exact.bin'), bytes(262_144))
  writeFileSync(join(dir, 'over.bin'), bytes(262_145))
  writeFileSync(join(dir, 'big.bin'), bytes(175 * 262_144 + 5))
  writeFileSync(join(dir, 'a/b/c/deep.txt'), 'hi\n')
  writeFileSync(join(dir, 'a/ünïcode ñame.txt'), 'ü\n')
  writeFileSync(join(dir, '.hidden'), 'secret')
}

describe('compute-cid (SPEC §12)', () => {
  it('matches omnipin for a directory with one small file', () => {
    const dir = join(root, 'one')
    mkdirSync(dir)
    writeFileSync(join(dir, 'one.txt'), 'x')
    expect(computeCid(dir)).toBe('bafybeid4mgfjaode5pcoeyp22r6w77ezfxo7mv4ghej7ztk2bl5n7743mm')
  })

  it('matches omnipin across chunking, layout and directory edge cases', () => {
    const dir = join(root, 'edge')
    mkdirSync(dir)
    fixture(dir)
    expect(computeCid(dir)).toBe('bafybeicp6kqeokgvg325okp4o4kj5qxxto6ug7xa6kyatiodoqa3mqn524')
  }, 120_000)

  it('encodes base32 like multibase', () => {
    expect(base32(new Uint8Array([0x01, 0x70]))).toBe('bafya')
    expect(base32(new TextEncoder().encode('foobar'))).toBe('bmzxw6ytboi')
  })
})

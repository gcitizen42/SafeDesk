// SPEC §9.5: localStorage and sessionStorage are never used, and only src/storage/ touches
// indexedDB. Biome's noRestrictedGlobals catches bare globals; this also catches member access
// such as `window.localStorage`.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? files(join(dir, d.name))
      : /\.(ts|tsx)$/.test(d.name)
        ? [join(dir, d.name)]
        : [],
  )

const sources = files(join(root, 'src'))
  .filter((f) => !f.endsWith('.test.ts'))
  .map((f) => ({ path: relative(root, f), text: readFileSync(f, 'utf8') }))

describe('storage rule', () => {
  it('never uses localStorage or sessionStorage', () => {
    const offenders = sources.filter((s) => /\b(localStorage|sessionStorage)\b/.test(s.text))
    expect(offenders.map((s) => s.path)).toEqual([])
  })

  it('only touches indexedDB inside src/storage/', () => {
    const offenders = sources.filter(
      (s) => !s.path.startsWith('src/storage/') && /\bindexedDB\b/.test(s.text),
    )
    expect(offenders.map((s) => s.path)).toEqual([])
  })
})

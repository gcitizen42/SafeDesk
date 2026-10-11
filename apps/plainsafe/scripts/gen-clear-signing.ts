// Generates the bundled clear-signing data (SPEC §7.2) from the ERC-7730 registry at a pinned commit:
// - src/generated/clear-signing/bundle.json: Safe's own descriptors and attestations, and the
//   auditor profiles (the "bundled" tier)
// - src/generated/clear-signing/manifest.json: path → SHA-256 for every other registry file,
//   including the two index files (the "manifest" tier). A file fetched on demand is dropped
//   unless its SHA-256 matches.
//
// Run: bun run gen:clear-signing   (REGISTRY_DIR=<existing checkout> skips the clone)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const REGISTRY = {
  repo: 'ethereum/clear-signing-erc7730-registry',
  commit: '73787861ec2ae7699aa74587adcb074afd78be92',
} as const

const OUT = new URL('../src/generated/clear-signing/', import.meta.url).pathname

function checkout(): string {
  const dir = process.env.REGISTRY_DIR ?? mkdtempSync(join(tmpdir(), 'erc7730-'))
  if (!process.env.REGISTRY_DIR) {
    execFileSync('git', ['clone', '--quiet', `https://github.com/${REGISTRY.repo}`, dir], {
      stdio: 'inherit',
    })
  }
  execFileSync('git', ['-C', dir, 'checkout', '--quiet', REGISTRY.commit], { stdio: 'inherit' })
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim()
  if (head !== REGISTRY.commit)
    throw new Error(`registry checkout is at ${head}, expected ${REGISTRY.commit}`)
  return dir
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** Test fixtures: `/test/`, `/tests/`, `/testsv2/`… */
const isTest = (path: string) => /\/tests?v?\d*\//.test(path)

function main() {
  const root = checkout()
  const files = [
    ...walk(join(root, 'registry')),
    ...walk(join(root, 'ercs')),
    ...walk(join(root, 'auditors')),
    join(root, 'index.calldata.json'),
    join(root, 'index.eip712.json'),
  ]
    .map((p) => relative(root, p))
    .filter((p) => p.endsWith('.json') && !isTest(p))
    .sort()

  const bundled: Record<string, unknown> = {}
  const manifest: Record<string, string> = {}
  for (const path of files) {
    const bytes = readFileSync(join(root, path))
    if (path.startsWith('registry/safe/') || path.startsWith('auditors/')) {
      bundled[path] = JSON.parse(bytes.toString('utf8'))
    } else {
      manifest[path] = createHash('sha256').update(bytes).digest('hex')
    }
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'bundle.json'), `${JSON.stringify({ ...REGISTRY, files: bundled })}\n`)
  writeFileSync(
    join(OUT, 'manifest.json'),
    `${JSON.stringify({ ...REGISTRY, files: manifest }, null, 1)}\n`,
  )
  const size = (f: string) => `${Math.round(statSync(join(OUT, f)).size / 1024)} KB`
  console.log(
    `bundled ${Object.keys(bundled).length} files (${size('bundle.json')}), manifest of ${Object.keys(manifest).length} (${size('manifest.json')})`,
  )
}

main()

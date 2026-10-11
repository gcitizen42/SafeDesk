import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Chain } from 'viem'
import { defineConfig, type Plugin } from 'vite'

// SPEC §8.1: CSP as defence in depth, production builds only (the dev server needs inline HMR code).
// connect-src is broad on purpose: RPCs are user-defined and netguard enforces the real allowlist.
// Plain http: only for a local node, as setup allows.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  'connect-src https: wss: http://localhost:* http://127.0.0.1:*',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'plainsafe-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
})

// main.tsx runs the gateway check before importing boot.tsx (SPEC §12), so the browser would
// only discover the app chunk after main.tsx has loaded and run. Preloading fetches it and its
// CSS in parallel, without running it: on a path gateway it's fetched but never evaluated.
const preloadBoot = (): Plugin => ({
  name: 'plainsafe-preload-boot',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const chunks = Object.values(ctx.bundle ?? {}).filter((c) => c.type === 'chunk')
      const boot = chunks.find((c) => c.facadeModuleId?.endsWith('/src/boot.tsx'))
      if (!boot) throw new Error('preload-boot: no chunk for src/boot.tsx')
      const js = new Set<string>()
      const css = new Set<string>()
      const visit = (fileName: string) => {
        const chunk = chunks.find((c) => c.fileName === fileName)
        if (!chunk || chunk.isEntry || js.has(fileName)) return
        js.add(fileName)
        for (const f of chunk.viteMetadata?.importedCss ?? []) css.add(f)
        for (const f of chunk.imports) visit(f)
      }
      visit(boot.fileName)
      return [
        ...[...css].map((f) => ({
          tag: 'link',
          attrs: { rel: 'preload', as: 'style', crossorigin: '', href: `./${f}` },
          injectTo: 'head' as const,
        })),
        ...[...js].map((f) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `./${f}` },
          injectTo: 'head' as const,
        })),
      ]
    },
  },
})

// SPEC §3.1: Add a chain needs only a few fields from viem/chains. They're extracted here at build
// time from the installed viem, so the lazy chunk is a small table instead of every full chain
// definition (formatters, serializers, RPC URLs).
const VIEM_CHAINS = 'virtual:viem-chains'
const viemChains = (): Plugin => ({
  name: 'plainsafe-viem-chains',
  resolveId: (id) => (id === VIEM_CHAINS ? `\0${VIEM_CHAINS}` : undefined),
  async load(id) {
    if (id !== `\0${VIEM_CHAINS}`) return
    const all: readonly Chain[] = Object.values(await import('viem/chains'))
    const table: Record<number, unknown> = {}
    for (const c of all) {
      // Some IDs have more than one export (e.g. anvil, foundry, hardhat); the first one wins.
      if (table[c.id]) continue
      table[c.id] = {
        name: c.name,
        nativeCurrency: c.nativeCurrency,
        ...(c.blockExplorers?.default.url ? { explorer: c.blockExplorers.default.url } : {}),
        ...(c.contracts?.multicall3?.address ? { multicall3: c.contracts.multicall3.address } : {}),
      }
    }
    return `export default ${JSON.stringify(table)}`
  },
})

// Settings → About (SPEC §3.12): version, commit and the dependencies actually installed.
function buildInfo() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const git = (...args: string[]) => {
    try {
      return execFileSync('git', args, { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const commit = git('rev-parse', 'HEAD') || 'unknown'
  const dirty = git('status', '--porcelain') !== ''
  const dependencies = Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const dep = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'))
      return { name, version: dep.version as string, license: (dep.license ?? '') as string }
    })
  return { version: pkg.version as string, commit, dirty, dependencies }
}

export default defineConfig({
  base: './',
  define: { __PLAINSAFE_BUILD__: JSON.stringify(buildInfo()) },
  plugins: [react(), tailwindcss(), csp(), viemChains(), preloadBoot()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
})

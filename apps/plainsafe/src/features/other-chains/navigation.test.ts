import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Router } from 'wouter'
import { Header } from '@/components/layout/header'
import { Routes } from '@/routes'

const context = vi.hoisted(() => ({ setupDone: false }))
vi.mock('@/queries/settings', () => ({
  useLoadedSettings: () => ({
    setupDone: context.setupDone,
    chains: [{ id: 1, name: 'Fixture EVM' }],
  }),
}))
vi.mock('@/features/network-log/network-log', () => ({ NetworkLogDrawer: () => null }))
vi.mock('@/features/settings/local-build', () => ({ LocalBuildBadge: () => null }))
vi.mock('@/wallet/connect-menu', () => ({
  ConnectMenu: () => createElement('button', { type: 'button' }, 'Fixture EVM connect'),
}))
vi.mock('@/wallet/local-policy', () => ({ walletActionsEnabled: () => true }))
vi.mock('@/features/builder/builder', () => ({
  Builder: () => 'Existing builder',
  NewTransaction: () => 'Existing new transaction',
  SwapScreen: () => 'Existing swap',
}))
vi.mock('@/features/queue/queue-screen', () => ({
  QueueScreen: ({ history }: { history?: boolean }) =>
    history ? 'Existing history' : 'Existing queue',
}))
vi.mock('@/features/review/draft-review', () => ({ DraftReview: () => 'Existing draft' }))
vi.mock('@/features/review/package-review', () => ({ PackageReview: () => 'Existing package' }))
vi.mock('@/features/safes/add-safe', () => ({ AddSafe: () => 'Existing add' }))
vi.mock('@/features/safes/create-safe', () => ({ CreateSafe: () => 'Existing create' }))
vi.mock('@/features/safes/home', () => ({ Home: () => 'Existing home' }))
vi.mock('@/features/safes/safe-overview', () => ({ SafeOverview: () => 'Existing overview' }))
vi.mock('@/features/settings/settings-screen', () => ({
  SettingsScreen: () => 'Existing settings',
}))
vi.mock('@/features/setup/setup-screen', () => ({ SetupScreen: () => 'Existing setup' }))
vi.mock('@/features/share/import', () => ({
  ImportPaste: () => 'Existing paste',
  ImportPayload: () => 'Existing payload',
}))
vi.mock('@/features/verify/verify-screen', () => ({ VerifyScreen: () => 'Existing verify' }))

function markup(path: string, children: ReactNode) {
  return renderToStaticMarkup(
    createElement(Router, {
      ssrPath: path,
      children,
    }),
  )
}
afterEach(() => {
  context.setupDone = false
  vi.unstubAllGlobals()
})

describe('Other Chains workspace route and tab', () => {
  it('adds the exact third tab and build-only label, hides EVM network/connect controls on this route', () => {
    const result = markup('/other-chains', createElement(Header))
    expect(result).toContain('aria-current="page" href="/other-chains"')
    expect(result).toContain('Other Chains')
    expect(result).toContain('Build and simulate only')
    expect(result).toContain('My Safe&#x27;s')
    expect(result).toContain('Safe Ownership Management')
    expect(result).not.toContain('workspace-network')
    expect(result).not.toContain('Fixture EVM connect')
    expect(result).not.toContain('Wallet actions enabled')
    expect(result).not.toContain('aria-current="page" href="/"')
  })

  it('preserves existing tabs and EVM controls on ordinary routes', () => {
    const result = markup('/', createElement(Header))
    expect(result).toContain('workspace-network')
    expect(result).toContain('Fixture EVM connect')
    expect(result).toContain('aria-current="page" href="/"')
    expect(result).toContain('Wallet actions enabled')
    const rotations = markup('/rotations', createElement(Header))
    expect(rotations).toContain('aria-current="page" href="/rotations"')
    expect(rotations).toContain('Approval controls active')
    expect(rotations).not.toContain('workspace-network')
  })

  it('allows Other Chains before EVM setup without opening wallets or fetching inspection', () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const result = markup('/other-chains', createElement(Routes))
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toContain('Existing setup')
    expect(result).toMatch(/Loading other chains|Other Chains/)
    expect(markup('/', createElement(Routes))).toBe('')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('retains all established EVM, settings, import and verification routes', () => {
    context.setupDone = true
    const safe = '/safe/1/fixture'
    const routes = [
      ['/', 'Existing home'],
      ['/setup', 'Existing setup'],
      ['/add', 'Existing add'],
      ['/add/new', 'Existing create'],
      [safe, 'Existing overview'],
      [`${safe}/queue`, 'Existing queue'],
      [`${safe}/history`, 'Existing history'],
      [`${safe}/new`, 'Existing new transaction'],
      [`${safe}/new/raw`, 'Existing builder'],
      [`${safe}/swap`, 'Existing swap'],
      [`${safe}/review`, 'Existing draft'],
      [`${safe}/tx/fixture`, 'Existing package'],
      ['/import', 'Existing paste'],
      ['/import/fixture', 'Existing payload'],
      ['/verify', 'Existing verify'],
      ['/settings', 'Existing settings'],
      ['/settings/about', 'Existing settings'],
    ]
    for (const [path, text] of routes) expect(markup(path, createElement(Routes))).toContain(text)
  })
})

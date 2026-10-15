import { Layers3, Settings, ShieldCheck, Users } from 'lucide-react'
import { Link, useLocation } from 'wouter'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { NetworkLogDrawer } from '@/features/network-log/network-log'
import { LocalBuildBadge } from '@/features/settings/local-build'
import { useNetworkScope } from '@/features/settings/network-scope'
import { useLoadedSettings } from '@/queries/settings'
import { ConnectMenu } from '@/wallet/connect-menu'
import { walletActionsEnabled } from '@/wallet/local-policy'

export function Header() {
  const { chains } = useLoadedSettings(),
    { network, setNetwork } = useNetworkScope(),
    [location, navigate] = useLocation()
  const rotations = location === '/rotations'
  const otherChains = location === '/other-chains'
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-16 max-w-4xl flex-wrap items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-auto flex shrink-0 items-center gap-2 font-semibold">
          <ShieldCheck className="size-6 text-emerald-700" aria-hidden="true" />
          SafeDesk
        </Link>
        {!rotations && !otherChains && (
          <label className="network-filter text-xs" htmlFor="workspace-network">
            Network
            <Select
              id="workspace-network"
              aria-label="Network"
              value={network}
              onChange={(e) => {
                if (e.target.value === 'add') {
                  navigate('/settings/rpcs')
                  return
                }
                setNetwork(e.target.value === 'all' ? 'all' : Number(e.target.value))
                navigate('/')
              }}
            >
              <option value="all">All networks</option>
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="add">Add network...</option>
            </Select>
          </label>
        )}
        <NetworkLogDrawer />
        {!rotations && !otherChains && <ConnectMenu />}
        <Button variant="ghost" size="icon" asChild aria-label="Settings">
          <Link href="/settings">
            <Settings />
          </Link>
        </Button>
      </div>
      <div className="desk-brand-credit mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4">
        <a href="https://github.com/gskril/plainsafe" target="_blank" rel="noreferrer">
          Built with PlainSafe
        </a>
        <LocalBuildBadge />
      </div>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4">
        <nav className="desk-tabs" aria-label="SafeDesk workspace">
          <Link href="/" aria-current={rotations || otherChains ? undefined : 'page'}>
            <ShieldCheck aria-hidden="true" />
            My Safe's
          </Link>
          <Link href="/rotations" aria-current={rotations ? 'page' : undefined}>
            <Users aria-hidden="true" />
            Safe Ownership Management
          </Link>
          <Link href="/other-chains" aria-current={otherChains ? 'page' : undefined}>
            <Layers3 aria-hidden="true" />
            Other Chains
          </Link>
        </nav>
        <span className="pb-2 text-xs text-amber-700 dark:text-amber-400">
          {otherChains
            ? 'Build and simulate only'
            : rotations
              ? 'Approval controls active'
              : walletActionsEnabled()
                ? 'Wallet actions enabled'
                : 'Read-only'}
        </span>
      </div>
    </header>
  )
}

import { Settings, ShieldCheck, Users } from 'lucide-react'
import { Link, useLocation } from 'wouter'
import { Select } from '@/components/select'
import { Button } from '@/components/ui/button'
import { NetworkLogDrawer } from '@/features/network-log/network-log'
import { useNetworkScope } from '@/features/settings/network-scope'
import { useLoadedSettings } from '@/queries/settings'
import { ConnectMenu } from '@/wallet/connect-menu'
import { walletActionsEnabled } from '@/wallet/local-policy'

export function Header() {
  const { chains } = useLoadedSettings(),
    { network, setNetwork } = useNetworkScope(),
    [, navigate] = useLocation()
  const rotations =
    document.querySelector<HTMLMetaElement>('meta[name="safedesk-rotation-origin"]')?.content ??
    'http://127.0.0.1:8770'
  return (
    <header className="border-b">
      <div className="mx-auto flex min-h-16 max-w-4xl flex-wrap items-center gap-2 px-4 py-3">
        <Link href="/" className="mr-auto flex shrink-0 items-center gap-2 font-semibold">
          <ShieldCheck className="size-6 text-emerald-700" aria-hidden="true" />
          SafeDesk
        </Link>
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
        <NetworkLogDrawer />
        <ConnectMenu />
        <Button variant="ghost" size="icon" asChild aria-label="Settings">
          <Link href="/settings">
            <Settings />
          </Link>
        </Button>
      </div>
      <div className="desk-brand-credit mx-auto max-w-4xl px-4">
        <a href="https://github.com/gskril/plainsafe" target="_blank" rel="noreferrer">
          Built with PlainSafe
        </a>
      </div>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4">
        <nav className="desk-tabs" aria-label="SafeDesk workspace">
          <Link href="/" aria-current="page">
            <ShieldCheck aria-hidden="true" />
            Safe Management
          </Link>
          <a href={rotations} rel="noreferrer">
            <Users aria-hidden="true" />
            Rotations &amp; Simulations
          </a>
        </nav>
        <span className="pb-2 text-xs text-amber-700 dark:text-amber-400">
          {walletActionsEnabled() ? 'Wallet actions enabled' : 'Read-only'} · Experimental
        </span>
      </div>
    </header>
  )
}

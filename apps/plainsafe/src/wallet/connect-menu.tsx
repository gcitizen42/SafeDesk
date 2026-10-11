// A small connect menu over wagmi's discovered connectors (SPEC §8.3). No third-party modal.
import { Wallet } from 'lucide-react'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEnsName } from '@/queries/ens'

/** Wallet icons are only shown when they are inline data, so they never cause a request. */
const safeIcon = (icon?: string) => (icon?.startsWith('data:image/') ? icon : undefined)

export function ConnectMenu() {
  const connection = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  // The wallet's primary name for the chain it's on (SPEC §8.3, §8.5)
  const ens = useEnsName(
    connection.chainId ?? 1,
    connection.status === 'connected' ? connection.address : undefined,
  )

  if (connection.status === 'connected') {
    const name = ens.data
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Shrinks on narrow screens by truncating the name; the address always shows next to
              it (SPEC §8.5: a name is never shown alone). */}
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 shrink"
            data-testid="wallet-button"
          >
            {/* On a phone the name needs the icon's room more */}
            <Wallet className={cn(name && 'max-sm:hidden')} />
            {name && (
              <span className="max-w-40 min-w-0 truncate" data-testid="ens-name">
                {name}
              </span>
            )}
            <span className={cn('font-mono', name && 'text-xs text-muted-foreground')}>
              {shortAddress(connection.address)}
            </span>
          </Button>
        </DropdownMenuTrigger>
        {/* As wide as the full address, not the button */}
        <DropdownMenuContent align="end" className="w-auto max-w-[calc(100vw-1rem)]">
          {name && (
            <DropdownMenuLabel className="text-sm break-all text-foreground">
              {name}
            </DropdownMenuLabel>
          )}
          <DropdownMenuLabel className="font-mono text-xs break-all">
            {connection.address}
          </DropdownMenuLabel>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {connection.connector.name} · chain {connection.chainId}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => disconnect.mutate({})}>Disconnect</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="wallet-button">
          <Wallet />
          {connection.status === 'connecting' ? 'Connecting…' : 'Connect'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {connectors.length === 0 && (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            No browser wallet found
          </DropdownMenuLabel>
        )}
        {connectors.map((connector) => {
          const icon = safeIcon(connector.icon)
          return (
            <DropdownMenuItem key={connector.uid} onSelect={() => connect.mutate({ connector })}>
              {icon ? <img src={icon} alt="" className="size-4" /> : <Wallet />}
              {connector.name}
            </DropdownMenuItem>
          )
        })}
        {connect.error && (
          <DropdownMenuLabel className="max-w-64 font-normal text-destructive">
            {connect.error.message.split('\n')[0]}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

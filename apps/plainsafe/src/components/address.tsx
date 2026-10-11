// An address as shown everywhere: the local label (address book only, SPEC §6) next to the
// shortened checksummed address, never alone. Copy button and explorer link.
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { getAddress } from 'viem'
import { explorerUrl } from '@/chains'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEnsName } from '@/queries/ens'
import { useLabelOf } from '@/queries/safes'
import { useChain } from '@/queries/settings'

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function AddressView(props: {
  chainId: number
  address: string
  full?: boolean
  /** Smaller, muted address next to a name, and copy/explorer buttons that show on hover. */
  compact?: boolean
  /** The address alone, where the page already shows its names right next to it. */
  addressOnly?: boolean
  /** In a narrow column: the address and its buttons move under the name, rather than squeezing it. */
  wrap?: boolean
}) {
  const labelOf = useLabelOf()
  const address = getAddress(props.address)
  const label = labelOf(props.chainId, address)
  // SPEC §8.5: a name is always shown next to the shortened address, never alone.
  const ens = useEnsName(props.chainId, address)
  const chain = useChain(props.chainId)
  const href = chain ? explorerUrl(chain, 'address', address) : undefined
  const names = !props.addressOnly
  const named = names && (!!label || !!ens.data)
  const shown = (
    <span
      className={cn(
        'font-mono break-all',
        props.compact && named ? 'text-xs text-muted-foreground' : 'text-sm',
      )}
      data-address={address}
    >
      {props.full ? address : shortAddress(address)}
    </span>
  )
  // On hover only where there's a pointer; always shown on touch screens
  const tools = props.compact
    ? 'sm:opacity-0 sm:group-hover/address:opacity-100 sm:focus-within:opacity-100'
    : ''
  return (
    <span
      className={cn(
        'group/address inline-flex min-w-0 items-center gap-1.5',
        props.wrap && 'flex-wrap gap-y-0',
      )}
    >
      {names && label && <span className="truncate font-medium">{label}</span>}
      {names && ens.data && (
        <span className="truncate text-sm text-sky-800 dark:text-sky-300" data-testid="ens-name">
          {ens.data}
        </span>
      )}
      {/* Wrapping, the address and its buttons move together */}
      <span className={props.wrap ? 'inline-flex items-center gap-1.5' : 'contents'}>
        {/* The full address only needs a tooltip when it's shortened */}
        {props.full ? (
          shown
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{shown}</TooltipTrigger>
            {/* Wider than the default 320px: a full address doesn't fit, and has nowhere to wrap */}
            <TooltipContent
              collisionPadding={8}
              className="max-w-[calc(100vw-1rem)] font-mono break-all"
            >
              {address}
            </TooltipContent>
          </Tooltip>
        )}
        <span className={cn('inline-flex items-center gap-1.5 transition-opacity', tools)}>
          <CopyButton value={address} label="Copy address" />
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in block explorer"
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </span>
      </span>
    </span>
  )
}

// #/settings and #/settings/:section (SPEC §3.12).
import { Link, useParams } from 'wouter'
import { NotFound } from '@/components/layout/not-found'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { useLoadedSettings, useSaveSettings } from '@/queries/settings'
import type { Currency } from '@/schemas/settings'
import { AbiSettings } from './abi-settings'
import { AboutSettings } from './about-settings'
import { AddressBookSettings } from './address-book-settings'
import { BackupSettings } from './backup-settings'
import { ClearSigningSettings } from './clear-signing-settings'
import { HistorySettings } from './history-settings'
import { NetworkAccessSettings, NetworkLogSettings } from './network-settings'
import { RpcSettings } from './rpc-settings'
import { TokensSettings } from './tokens-settings'

const SECTIONS = [
  ['rpcs', 'RPCs', RpcSettings],
  ['network', 'Network access', NetworkAccessSettings],
  ['log', 'Network log', NetworkLogSettings],
  ['tokens', 'Token lists and My tokens', TokensSettings],
  ['addressbook', 'Address book', AddressBookSettings],
  ['clear-signing', 'Clear signing', ClearSigningSettings],
  ['abis', 'ABI library', AbiSettings],
  ['currency', 'Currency', CurrencySettings],
  ['backup', 'Back up and Restore', BackupSettings],
  ['history', 'Onchain history', HistorySettings],
  ['about', 'About', AboutSettings],
] as const

export function SettingsScreen() {
  const { section } = useParams<{ section?: string }>()
  const Section = SECTIONS.find(([id]) => id === section)?.[2]
  if (section && !Section) return <NotFound />
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row">
      <nav className="flex shrink-0 flex-row flex-wrap gap-1 md:w-52 md:flex-col">
        {SECTIONS.map(([id, label]) => (
          <Link
            key={id}
            href={`/settings/${id}`}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm',
              id === section ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {Section ? <Section /> : <p className="text-muted-foreground">Choose a section.</p>}
      </div>
    </div>
  )
}

function CurrencySettings() {
  const settings = useLoadedSettings()
  const save = useSaveSettings()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Currency</h2>
      <p className="text-sm text-muted-foreground">
        Values are ≈ spot prices from the 1inch Spot Price Aggregator (an onchain contract) and are
        for display only. USD and EUR need a Mainnet RPC.
      </p>
      <RadioGroup
        value={settings.currency}
        onValueChange={(v) => save.mutate({ ...settings, currency: v as Currency })}
        className="flex gap-4"
      >
        {(['ETH', 'USD', 'EUR'] as const).map((c) => (
          <Label key={c} className="flex items-center gap-2 font-normal">
            <RadioGroupItem value={c} /> {c}
          </Label>
        ))}
      </RadioGroup>
    </section>
  )
}

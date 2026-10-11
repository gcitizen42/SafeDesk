// #/safe/:chainId/:address/new and /new/:preset (SPEC §3.3).
import { ArrowLeftRight, Coins, FileCode2, Repeat, Send, Users } from 'lucide-react'
import { useState } from 'react'
import { type Address, isAddress, zeroAddress } from 'viem'
import { Link, useLocation, useParams } from 'wouter'
import { NotFound } from '@/components/layout/not-found'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authenticityReason } from '@/core/authenticity'
import { completeTx, nextNonce } from '@/core/builders'
import type { SafeTx } from '@/core/safe-tx'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { useSafeParams } from '@/features/safes/use-safe-params'
import { SwapPreset } from '@/features/swap/swap-preset'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { usePackages } from '@/queries/packages'
import { useSafe } from '@/queries/safes'
import { useNativeCurrency } from '@/queries/settings'
import { useSwapContracts } from '@/queries/swap'
import { useBalances } from '@/queries/tokens'
import { ContractCall } from './contract-call'
import { setDraft } from './draft'
import { type BuiltCall, OwnersAndThreshold, SendErc20, SendNative } from './presets'

const PRESETS = ['eth', 'erc20', 'call', 'owners', 'swap'] as const
type Preset = (typeof PRESETS)[number]

function usePresetMeta(chainId: number) {
  const { symbol } = useNativeCurrency(chainId)
  return {
    eth: { title: `Send ${symbol}`, icon: Send, blurb: `Send ${symbol} from the Safe.` },
    erc20: { title: 'Send a token', icon: Coins, blurb: 'Send an ERC-20 token.' },
    call: {
      title: 'Contract call',
      icon: FileCode2,
      blurb: 'Call any contract function, or send raw calldata.',
    },
    owners: {
      title: 'Owners and threshold',
      icon: Users,
      blurb: 'Add, remove or replace owners, or change the threshold.',
    },
    swap: {
      title: 'Swap',
      icon: Repeat,
      blurb: 'Swap tokens on Uniswap, quoted onchain.',
    },
  } satisfies Record<Preset, { title: string; icon: typeof Send; blurb: string }>
}

/** The presets for this chain: Swap is hidden where Uniswap's contracts aren't deployed. */
function usePresets(chainId: number): readonly Preset[] {
  const swap = useSwapContracts(chainId)
  return PRESETS.filter((p) => p !== 'swap' || !!swap.data)
}

export function NewTransaction() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  return <PresetPicker chainId={target.chainId} address={target.address} />
}

function PresetPicker({ chainId, address }: { chainId: number; address: Address }) {
  const meta = usePresetMeta(chainId)
  const presets = usePresets(chainId)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">New transaction</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {presets.map((p) => {
          const { title, icon: Icon, blurb } = meta[p]
          return (
            <Link
              key={p}
              href={`/safe/${chainId}/${address}/new/${p}`}
              className="flex flex-col gap-1 rounded-lg border p-4 hover:bg-muted"
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="size-4" /> {title}
              </span>
              <span className="text-sm text-muted-foreground">{blurb}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function Builder() {
  const target = useSafeParams()
  const { preset } = useParams<{ preset: string }>()
  if (!target || !PRESETS.includes(preset as Preset)) return <NotFound />
  return <BuilderFor chainId={target.chainId} address={target.address} preset={preset as Preset} />
}

/** #/safe/:chainId/:address/swap (SPEC §9.4): the builder with the swap preset. */
export function SwapScreen() {
  const target = useSafeParams()
  if (!target) return <NotFound />
  return <BuilderFor chainId={target.chainId} address={target.address} preset="swap" />
}

function BuilderFor({
  chainId,
  address,
  preset,
}: {
  chainId: number
  address: Address
  preset: Preset
}) {
  // Fresh on entry: the default nonce and the balances come from this read. Balances start now,
  // alongside the Safe, so their reads share its batches (the presets use the same query)
  const safe = useSafe(chainId, address, { fresh: true })
  useBalances(chainId, address, { fresh: true })
  const meta = usePresetMeta(chainId)
  const presets = usePresets(chainId)
  const base = `/safe/${chainId}/${address}`
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">New transaction</h1>
        <nav className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Link
              key={p}
              href={`${base}/new/${p}`}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm',
                p === preset ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {meta[p].title}
            </Link>
          ))}
        </nav>
      </div>
      {safe.isPending && <p className="text-muted-foreground">Reading the Safe…</p>}
      {safe.error && <p className="text-destructive">{describeError(safe.error)}</p>}
      {safe.data && safe.data.authenticity.status !== 'verified' && (
        <p className="text-destructive">{authenticityReason(safe.data.authenticity)}</p>
      )}
      {safe.data?.authenticity.status === 'verified' && (
        <Form key={preset} safe={safe.data} preset={preset} />
      )}
    </div>
  )
}

const num = (t: string) => (/^\d+$/.test(t) ? BigInt(t) : undefined)
const addr = (t: string) =>
  isAddress(t.trim(), { strict: true }) ? (t.trim() as Address) : undefined

const ADVANCED = {
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  gasToken: zeroAddress as string,
  refundReceiver: zeroAddress as string,
}

/** The advanced fields (SPEC §3.3), or undefined while any of them is invalid. */
function parseAdvanced(
  a: typeof ADVANCED,
): Pick<SafeTx, 'safeTxGas' | 'baseGas' | 'gasPrice' | 'gasToken' | 'refundReceiver'> | undefined {
  const safeTxGas = num(a.safeTxGas)
  const baseGas = num(a.baseGas)
  const gasPrice = num(a.gasPrice)
  const gasToken = addr(a.gasToken)
  const refundReceiver = addr(a.refundReceiver)
  return safeTxGas !== undefined &&
    baseGas !== undefined &&
    gasPrice !== undefined &&
    gasToken &&
    refundReceiver
    ? { safeTxGas, baseGas, gasPrice, gasToken, refundReceiver }
    : undefined
}

function Form({ safe, preset }: { safe: SafeSnapshot; preset: Preset }) {
  const [, navigate] = useLocation()
  const [built, setBuilt] = useState<BuiltCall>()
  const onchainNonce = safe.nonce ?? 0n
  const queue = usePackages(safe.chainId, safe.address)
  // SPEC §3.3: max(onchain nonce, highest queued nonce + 1)
  const queued = (queue.data?.packages ?? [])
    .filter((p) => !p.execution)
    .map((p) => p.verified.tx.nonce)
  const [nonceText, setNonceText] = useState<string>()
  const defaultNonce = nextNonce(onchainNonce, queued)
  const nonceValue = nonceText ?? defaultNonce.toString()
  const [adv, setAdv] = useState(ADVANCED)

  const nonce = num(nonceValue)
  const advanced = parseAdvanced(adv)
  const refundFields =
    !!advanced &&
    (advanced.gasPrice !== 0n ||
      advanced.gasToken !== zeroAddress ||
      advanced.refundReceiver !== zeroAddress)

  const tx: SafeTx | undefined =
    built && nonce !== undefined && advanced
      ? { ...completeTx(built.call, nonce), ...advanced }
      : undefined

  const onReview = () => {
    if (!tx || !built) return
    setDraft({
      chainId: safe.chainId,
      safe: safe.address,
      tx,
      description: built.description,
      preset,
    })
    navigate(`/safe/${safe.chainId}/${safe.address}/review`)
  }

  const Preset = {
    eth: SendNative,
    erc20: SendErc20,
    call: ContractCall,
    owners: OwnersAndThreshold,
    swap: SwapPreset,
  }[preset]
  return (
    <div className="flex flex-col gap-6">
      <Preset safe={safe} onResult={setBuilt} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nonce">Nonce</Label>
        <Input
          id="nonce"
          value={nonceValue}
          onChange={(e) => setNonceText(e.target.value)}
          inputMode="numeric"
          className="w-32 font-mono"
        />
        {nonce !== undefined && nonce !== onchainNonce && (
          <p className="text-sm text-muted-foreground">
            {nonce < onchainNonce
              ? `Nonce ${nonce} is already used onchain (next is ${onchainNonce}); this transaction can never execute.`
              : `The onchain nonce is ${onchainNonce}. This transaction waits until earlier nonces execute.`}
          </p>
        )}
      </div>
      <Collapsible className="rounded-lg border">
        <CollapsibleTrigger className="w-full p-3 text-left text-sm font-medium">
          Advanced (gas refund fields)
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 px-3 pb-3">
          {(['safeTxGas', 'baseGas', 'gasPrice', 'gasToken', 'refundReceiver'] as const).map(
            (f) => (
              <div key={f} className="flex flex-col gap-1">
                <Label htmlFor={f} className="font-mono text-xs">
                  {f}
                </Label>
                <Input
                  id={f}
                  value={adv[f]}
                  onChange={(e) => setAdv((a) => ({ ...a, [f]: e.target.value }))}
                  className="font-mono text-sm"
                  spellCheck={false}
                />
              </div>
            ),
          )}
          {!advanced && (
            <p className="text-sm text-destructive">Enter whole numbers and valid addresses.</p>
          )}
        </CollapsibleContent>
      </Collapsible>
      {refundFields && (
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm dark:border-yellow-900 dark:bg-yellow-950/40">
          Gas refund fields are set. The executor gets paid from the Safe (gasPrice × gas in
          gasToken, sent to refundReceiver). A malicious combination can drain funds. Leave them at
          0 unless you know you need them.
        </p>
      )}
      <Button size="lg" className="self-end" disabled={!tx} onClick={onReview}>
        <ArrowLeftRight /> Review
      </Button>
    </div>
  )
}

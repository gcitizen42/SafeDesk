// One row of the onchain history feed (SPEC §11): a multisig execution, a module's, or an event
// on its own. Each opens in place to show what the execution did, who signed it and its hashes.
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  ChevronDown,
  CircleX,
  Code,
  Globe,
  Layers,
  Puzzle,
  Settings2,
  ShieldCheck,
  Stamp,
  Users,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { type Address, formatUnits, getAddress, type Hex, maxUint256, zeroAddress } from 'viem'
import { Link } from 'wouter'
import { explorerUrl } from '@/chains'
import { AddressView, CopyButton } from '@/components/address'
import type { Decoded } from '@/core/decode'
import { isExecution, txFromCalldata, txFromL2Event } from '@/core/history'
import type { FeedItem, OwnerChange } from '@/core/history-feed'
import type { BatchCall } from '@/core/multisend'
import type { SafeTx } from '@/core/safe-tx'
import { type ExecutedSignature, signatureParts } from '@/core/signatures'
import { DecodedView } from '@/features/review/decoded-view'
import { TxFields } from '@/features/review/tx-fields'
import { useCallDecoding, useTxSummary } from '@/features/review/tx-summary'
import type { SafeSnapshot } from '@/features/safes/load-safe'
import { describeError } from '@/lib/errors'
import { plural, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useTokenMeta } from '@/queries/contracts'
import { useExecutedSigners, useExecutingTransaction } from '@/queries/history'
import { usePackages } from '@/queries/packages'
import { useChain, useNativeCurrency } from '@/queries/settings'
import { useTokenUniverse } from '@/queries/tokens'
import type { HistoryEvent } from '@/schemas/history'

/** A block timestamp (seconds) as the local time of day. */
const timeLabel = (timestamp: string | undefined) =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(Number(timestamp) * 1000),
      )
    : ''

const TONES = {
  neutral: 'bg-muted text-foreground',
  muted: 'bg-muted text-muted-foreground',
  in: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  owners: 'bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  ens: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
} as const
type Tone = keyof typeof TONES

/** A row that opens in place; what's inside is rendered only while it's open. */
function RowShell(props: {
  icon: ReactNode
  tone: Tone
  title: ReactNode
  meta?: ReactNode
  time: string
  open: boolean
  onOpenChange: (open: boolean) => void
  testId?: string
  children: ReactNode
}) {
  return (
    <li data-testid={props.testId}>
      <details
        className="group"
        open={props.open}
        onToggle={(ev) => props.onOpenChange(ev.currentTarget.open)}
      >
        <summary className="grid cursor-pointer list-none grid-cols-[2rem_minmax(0,1fr)_auto_1rem] items-center gap-x-4 px-4 py-3.5 group-open:bg-muted/50 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-full [&_svg]:size-4',
              TONES[props.tone],
            )}
          >
            {props.icon}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] break-words">{props.title}</span>
            {props.meta && <span className="text-sm text-muted-foreground">{props.meta}</span>}
          </span>
          <span className="text-sm text-muted-foreground">{props.time}</span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        {props.open && (
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 bg-muted/50 pt-1 pr-4 pb-4 pl-16 text-sm">
            {props.children}
          </dl>
        )}
      </details>
    </li>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

const Mono = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="font-mono text-[13px]" title={title}>
    {children}
  </span>
)

interface RowContext {
  readonly chainId: number
  readonly safe: Address
  readonly snapshot: SafeSnapshot | undefined
  /** The Safe's onchain nonce. */
  readonly nonce: bigint | undefined
  /** How many multisig executions came after this row's. */
  readonly later: number
}

export function FeedRow(props: RowContext & { item: FeedItem }) {
  const { item } = props
  if (item.kind === 'execution' && isExecution(item.event.name))
    return <ExecutionRow {...props} item={item} />
  if (item.kind === 'execution') return <ModuleRow {...props} item={item} />
  return <EventRow {...props} event={item.event} />
}

type Execution = Extract<FeedItem, { kind: 'execution' }>

/** A multisig execution, its details recovered in the order of SPEC §11. */
function ExecutionRow(props: RowContext & { item: Execution }) {
  const { chainId, safe, item, nonce } = props
  const e = item.event
  const safeTxHash = String(e.args.txHash) as Hex
  const [open, setOpen] = useState(false)
  const packages = usePackages(chainId, safe)
  // 1. L2 Safes: SafeMultiSigTransaction, just before. Memoized like fromL1: the decoding
  // downstream is memoized on the tx object
  const fromL2 = useMemo(
    () =>
      item.detail?.name === 'SafeMultiSigTransaction' ? txFromL2Event(item.detail.args) : undefined,
    [item.detail],
  )
  // 3. A local package with the same safeTxHash
  const local = packages.data?.packages.find(
    (p) => p.verified.hashes.safeTx.toLowerCase() === safeTxHash.toLowerCase(),
  )
  // 2. L1 Safes: the transaction's execTransaction, the nonce checked by the hash. Also read when
  // the row is opened, for who sent it and the signatures it carried.
  const needed = !fromL2 && !local && nonce !== undefined
  const sent = useExecutingTransaction(chainId, e, needed || open)
  // A local package knows its nonce; otherwise it's guessed from the executions after this one
  const nonceGuess =
    local?.verified.tx.nonce ?? (nonce !== undefined ? nonce - 1n - BigInt(props.later) : undefined)
  const fromL1 = useMemo(
    () =>
      sent.data && nonceGuess !== undefined
        ? txFromCalldata({
            input: sent.data.input,
            to: sent.data.to,
            chainId,
            safe,
            safeTxHash,
            nonceGuess,
          })
        : undefined,
    [sent.data, nonceGuess, chainId, safe, safeTxHash],
  )
  const tx: SafeTx | undefined = fromL2?.tx ?? local?.verified.tx ?? fromL1?.tx
  const failed = e.name === 'ExecutionFailure'

  if (!tx) {
    const loading = sent.isPending && needed
    return (
      <RowShell
        icon={<Code />}
        tone="muted"
        title={
          loading ? 'Loading details…' : 'Executed via another contract. Details need tracing.'
        }
        meta={failed ? <span className="text-destructive">inner call failed</span> : undefined}
        time={timeLabel(e.timestamp)}
        open={open}
        onOpenChange={setOpen}
        testId="history-execution"
      >
        {sent.error && (
          <Field label="Error">
            <span className="text-muted-foreground">{describeError(sent.error)}</span>
          </Field>
        )}
        <HashFields chainId={chainId} safeTxHash={safeTxHash} event={e} />
      </RowShell>
    )
  }
  return (
    <KnownExecution
      {...props}
      safeTxHash={safeTxHash}
      tx={tx}
      signatures={fromL2?.signatures ?? fromL1?.signatures}
      reading={sent.isPending}
      readError={sent.error}
      sender={sent.data?.from}
      localHref={local ? `/safe/${chainId}/${safe}/tx/${local.verified.hashes.safeTx}` : undefined}
      failed={failed}
      open={open}
      onOpenChange={setOpen}
    />
  )
}

function KnownExecution(props: {
  chainId: number
  safe: Address
  snapshot: SafeSnapshot | undefined
  item: Execution
  safeTxHash: Hex
  tx: SafeTx
  signatures: Hex | undefined
  /** The executing transaction, where the signatures come from on L1 Safes. */
  reading: boolean
  readError: Error | null
  sender: Address | undefined
  localHref: string | undefined
  failed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { chainId, safe, item, safeTxHash, tx, failed } = props
  const summary = useTxSummary(chainId, safe, props.snapshot, tx, safeTxHash)
  const decoded = summary.decoded
  const count = props.signatures ? signatureParts(props.signatures).length : undefined
  const signed =
    count === undefined
      ? undefined
      : item.threshold !== undefined
        ? `${count} of ${plural(item.threshold, 'signature')}`
        : plural(count, 'signature')
  const meta = [
    `#${tx.nonce}`,
    decoded?.kind === 'batch' ? `batch of ${decoded.calls.length}` : undefined,
    signed,
  ]
    .filter(Boolean)
    .join(' · ')
  const look = executionLook(safe, tx, decoded, item, failed)
  return (
    <RowShell
      icon={look.icon}
      tone={look.tone}
      title={
        <span
          data-testid="history-summary"
          title={summary.clearSigning ? 'Clear signing, not reviewed' : undefined}
        >
          {summary.text}
        </span>
      }
      meta={
        <>
          {meta}
          {failed && <span className="text-destructive"> · inner call failed</span>}
        </>
      }
      time={timeLabel(item.event.timestamp)}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="history-execution"
    >
      <Field label={decoded?.kind === 'batch' ? 'Calls' : 'Call'}>
        <CallsView chainId={chainId} safe={safe} tx={tx} decoded={decoded} />
      </Field>
      {item.owners && (
        <Field label="Owners">
          <OwnersView change={item.owners} />
        </Field>
      )}
      <AlsoLogged chainId={chainId} safe={safe} effects={item.effects} />
      <Field label="Signed by">
        <SignersView
          chainId={chainId}
          safeTxHash={safeTxHash}
          signatures={props.signatures}
          reading={props.reading}
          readError={props.readError}
          sender={props.sender}
          threshold={item.threshold}
        />
      </Field>
      <HashFields chainId={chainId} safeTxHash={safeTxHash} event={item.event} />
      <Field label="">
        <div className="flex flex-col gap-2">
          {props.localHref && (
            <Link href={props.localHref} className="underline underline-offset-4">
              Open the saved transaction
            </Link>
          )}
          <HistoryDetails chainId={chainId} safe={safe} tx={tx} />
        </div>
      </Field>
    </RowShell>
  )
}

const OWNER_EVENTS = new Set(['AddedOwner', 'RemovedOwner', 'ChangedThreshold'])

/** What else an execution logged, in words; its owner changes have their own field. */
function AlsoLogged(props: { chainId: number; safe: Address; effects: readonly HistoryEvent[] }) {
  const { chainId, safe } = props
  const others = props.effects.filter(
    (x) =>
      !OWNER_EVENTS.has(x.name) &&
      // A call to the Safe itself (a cancel) logs receiving its 0 ETH: not worth a line
      !(
        x.name === 'SafeReceived' &&
        String(x.args.value) === '0' &&
        getAddress(String(x.args.sender)) === getAddress(safe)
      ),
  )
  if (others.length === 0) return null
  return (
    <Field label="Also logged">
      <ul className="flex flex-col gap-1">
        {others.map((x) => (
          <li key={`${x.blockNumber}:${x.logIndex}`}>
            <EventText chainId={chainId} safe={safe} event={x} />
          </li>
        ))}
      </ul>
    </Field>
  )
}

function executionLook(
  safe: Address,
  tx: SafeTx,
  decoded: Decoded | undefined,
  item: Execution,
  failed: boolean,
): { icon: ReactNode; tone: Tone } {
  if (failed) return { icon: <CircleX />, tone: 'failed' }
  if (item.owners) return { icon: <Users />, tone: 'owners' }
  const toSafe = getAddress(tx.to) === getAddress(safe)
  if (toSafe && decoded?.kind === 'empty' && tx.value === 0n)
    return { icon: <Ban />, tone: 'muted' }
  if (toSafe) return { icon: <Settings2 />, tone: 'owners' }
  if (decoded?.kind === 'batch') return { icon: <Layers />, tone: 'neutral' }
  if (decoded?.kind === 'empty') return { icon: <ArrowUpRight />, tone: 'neutral' }
  if (decoded?.kind === 'abi' && decoded.source.startsWith('ENS'))
    return { icon: <Globe />, tone: 'ens' }
  if (decoded?.kind === 'abi' && decoded.source.startsWith('ERC-20'))
    return { icon: <ArrowUpRight />, tone: 'neutral' }
  return { icon: <Code />, tone: 'neutral' }
}

/** A module's execution: modules act without signatures (SPEC §11). */
function ModuleRow(props: { chainId: number; safe: Address; item: Execution }) {
  const { chainId, safe, item } = props
  const [open, setOpen] = useState(false)
  const failed = item.event.name === 'ExecutionFromModuleFailure'
  const module = getAddress(String(item.event.args.module))
  const d = item.detail?.args
  return (
    <RowShell
      icon={failed ? <CircleX /> : <Puzzle />}
      tone={failed ? 'failed' : item.owners ? 'owners' : 'neutral'}
      title={`Module ${shortAddress(module)} executed a call`}
      meta={
        failed ? (
          <span className="text-destructive">inner call failed</span>
        ) : (
          'no signatures needed'
        )
      }
      time={timeLabel(item.event.timestamp)}
      open={open}
      onOpenChange={setOpen}
    >
      <Field label="Module">
        <AddressView chainId={chainId} address={module} />
      </Field>
      {d && (
        <Field label="Call">
          <span className="flex flex-col gap-1">
            <span>
              {Number(d.operation) === 1 ? 'Delegatecall to ' : 'To '}
              <Mono title={String(d.to)}>{shortAddress(String(d.to))}</Mono>
              {String(d.value) !== '0' && ` with ${String(d.value)} wei`}
            </span>
            <Mono>
              <span className="break-all">{shortData(String(d.data))}</span>
            </Mono>
          </span>
        </Field>
      )}
      {item.owners && (
        <Field label="Owners">
          <OwnersView change={item.owners} />
        </Field>
      )}
      <AlsoLogged chainId={chainId} safe={safe} effects={item.effects} />
      <Field label="Transaction">
        <TxLink chainId={chainId} event={item.event} />
      </Field>
    </RowShell>
  )
}

/** An event outside any execution: ETH received, the Safe's creation, an onchain approval… */
function EventRow(props: { chainId: number; safe: Address; event: HistoryEvent }) {
  const { chainId, safe, event: e } = props
  const [open, setOpen] = useState(false)
  const native = useNativeAmount(chainId)
  return (
    <RowShell
      {...eventLook(chainId, safe, e, native)}
      time={timeLabel(e.timestamp)}
      open={open}
      onOpenChange={setOpen}
      testId="history-event"
    >
      {e.name === 'SafeReceived' && (
        <Field label="From">
          <AddressView chainId={chainId} address={String(e.args.sender)} />
        </Field>
      )}
      {e.name === 'SafeSetup' && (
        <>
          <Field label="Owners">
            <Chips owners={(e.args.owners as readonly string[]).map((o) => getAddress(o))} />
          </Field>
          <Field label="Threshold">{String(e.args.threshold)}</Field>
          {String(e.args.fallbackHandler) !== zeroAddress && (
            <Field label="Fallback handler">
              <AddressView chainId={chainId} address={String(e.args.fallbackHandler)} />
            </Field>
          )}
        </>
      )}
      {e.name !== 'SafeReceived' && e.name !== 'SafeSetup' && Object.keys(e.args).length > 0 && (
        <Field label="Logged">
          <span className="flex flex-col gap-1">
            {Object.entries(e.args)
              .filter(([k]) => k !== 'signatures' && k !== 'additionalInfo')
              .map(([k, v]) => (
                <span key={k}>
                  {k} <Mono>{Array.isArray(v) ? v.join(', ') : shortData(String(v))}</Mono>
                </span>
              ))}
          </span>
        </Field>
      )}
      <Field label="Transaction">
        <TxLink chainId={chainId} event={e} />
      </Field>
    </RowShell>
  )
}

function eventLook(
  chainId: number,
  safe: Address,
  e: HistoryEvent,
  native: (wei: bigint) => string,
): { icon: ReactNode; tone: Tone; title: ReactNode; meta?: ReactNode } {
  switch (e.name) {
    case 'SafeReceived':
      return {
        icon: <ArrowDownLeft />,
        tone: 'in',
        title: (
          <>
            Received{' '}
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {native(BigInt(String(e.args.value)))}
            </span>
          </>
        ),
        meta: (
          <>
            from <Mono title={String(e.args.sender)}>{shortAddress(String(e.args.sender))}</Mono>
          </>
        ),
      }
    case 'SafeSetup':
      return {
        icon: <ShieldCheck />,
        tone: 'neutral',
        title: `Safe created with ${plural((e.args.owners as readonly string[]).length, 'owner')} and threshold ${String(e.args.threshold)}`,
      }
    case 'ApproveHash':
      return {
        icon: <Stamp />,
        tone: 'neutral',
        title: (
          <>
            <Mono title={String(e.args.owner)}>{shortAddress(String(e.args.owner))}</Mono> approved
            a transaction onchain
          </>
        ),
        meta: <Mono>{shortData(String(e.args.approvedHash))}</Mono>,
      }
    default:
      return {
        icon: OWNER_EVENTS.has(e.name) ? <Users /> : <Settings2 />,
        tone: OWNER_EVENTS.has(e.name) ? 'owners' : 'neutral',
        title: <EventText chainId={chainId} safe={safe} event={e} />,
      }
  }
}

// ---------- pieces of a row ----------

/** An amount of the chain's native currency, in words: "1.5 ETH". */
function useNativeAmount(chainId: number) {
  const { symbol, decimals } = useNativeCurrency(chainId)
  return (wei: bigint) => `${formatUnits(wei, decimals)} ${symbol}`
}

/** The safeTxHash (with copy) and the transaction that executed it. */
function HashFields(props: { chainId: number; safeTxHash: Hex; event: HistoryEvent }) {
  return (
    <>
      <Field label="safeTxHash">
        <span className="flex items-start gap-1">
          <Mono>
            <span className="break-all">{props.safeTxHash}</span>
          </Mono>
          <CopyButton value={props.safeTxHash} label="Copy safeTxHash" />
        </span>
      </Field>
      <Field label="Transaction">
        <TxLink chainId={props.chainId} event={props.event} />
      </Field>
    </>
  )
}

function TxLink({ chainId, event }: { chainId: number; event: HistoryEvent }) {
  const chain = useChain(chainId)
  const href = chain ? explorerUrl(chain, 'tx', event.transactionHash) : undefined
  const text = shortData(event.transactionHash)
  return (
    <span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          <Mono>{text}</Mono>
        </a>
      ) : (
        <Mono>{text}</Mono>
      )}{' '}
      <span className="text-muted-foreground">
        · block {Number(event.blockNumber).toLocaleString()}
      </span>
    </span>
  )
}

/** `0x1234…abcd`, with the length for anything longer than a word. */
function shortData(data: string): string {
  if (!data.startsWith('0x') || data.length <= 20) return data
  const bytes = (data.length - 2) / 2
  return `${data.slice(0, 6)}…${data.slice(-4)}${bytes > 32 ? ` (${bytes} bytes)` : ''}`
}

/** One line per event the Safe logged, in words. */
function EventText({
  chainId,
  safe,
  event: e,
}: {
  chainId: number
  safe: Address
  event: HistoryEvent
}) {
  const native = useNativeAmount(chainId)
  const a = (k: string) => {
    const v = getAddress(String(e.args[k]))
    return <Mono title={v}>{v === zeroAddress ? 'none' : target(v, safe)}</Mono>
  }
  switch (e.name) {
    case 'SafeReceived':
      return (
        <>
          Received {native(BigInt(String(e.args.value)))} from {a('sender')}
        </>
      )
    case 'AddedOwner':
      return <>Owner added: {a('owner')}</>
    case 'RemovedOwner':
      return <>Owner removed: {a('owner')}</>
    case 'ChangedThreshold':
      return <>Threshold changed to {String(e.args.threshold)}</>
    case 'EnabledModule':
      return <>Module enabled: {a('module')}</>
    case 'DisabledModule':
      return <>Module disabled: {a('module')}</>
    case 'ChangedGuard':
      return <>Guard set to {a('guard')}</>
    case 'ChangedModuleGuard':
      return <>Module guard set to {a('moduleGuard')}</>
    case 'ChangedFallbackHandler':
      return <>Fallback handler set to {a('handler')}</>
    case 'ChangedMasterCopy':
      return <>Singleton changed to {a('singleton')}</>
    case 'ApproveHash':
      return (
        <>
          {a('owner')} approved <Mono>{shortData(String(e.args.approvedHash))}</Mono> onchain
        </>
      )
    case 'SignMsg':
      return (
        <>
          Message signed onchain: <Mono>{shortData(String(e.args.msgHash))}</Mono>
        </>
      )
    default:
      return (
        <>
          {e.name}
          {Object.keys(e.args).length > 0 &&
            `: ${Object.entries(e.args)
              .filter(([k]) => k !== 'data' && k !== 'signatures' && k !== 'additionalInfo')
              .map(([k, v]) => `${k} ${String(v).slice(0, 42)}`)
              .join(', ')}`}
        </>
      )
  }
}

function Chips({
  owners,
  added = [],
  removed = [],
}: {
  owners: readonly Address[]
  added?: readonly Address[]
  removed?: readonly Address[]
}) {
  const isIn = (list: readonly Address[], a: Address) =>
    list.some((x) => x.toLowerCase() === a.toLowerCase())
  const chip = 'rounded-full px-2.5 py-0.5 font-mono text-[13px]'
  return (
    <span className="flex flex-wrap gap-1.5">
      {removed.map((o) => (
        <span
          key={`-${o}`}
          title={o}
          className={cn(chip, 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300')}
        >
          − {shortAddress(o)}
        </span>
      ))}
      {added.map((o) => (
        <span
          key={`+${o}`}
          title={o}
          className={cn(
            chip,
            'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
          )}
        >
          + {shortAddress(o)}
        </span>
      ))}
      {owners
        .filter((o) => !isIn(added, o))
        .map((o) => (
          <span key={o} title={o} className={cn(chip, 'border text-muted-foreground')}>
            {shortAddress(o)}
          </span>
        ))}
    </span>
  )
}

function OwnersView({ change }: { change: OwnerChange }) {
  const { before, after, thresholdBefore: tb, thresholdAfter: ta } = change
  const owners =
    before && after
      ? `${before.length} → ${plural(after.length, 'owner')}`
      : [
          change.added.length ? `${change.added.length} added` : '',
          change.removed.length ? `${change.removed.length} removed` : '',
        ]
          .filter(Boolean)
          .join(', ')
  const threshold =
    tb !== undefined && ta !== undefined
      ? tb === ta
        ? `threshold stays ${ta}`
        : `threshold ${tb} → ${ta}`
      : ta !== undefined
        ? `threshold ${ta}`
        : ''
  return (
    <span className="flex flex-col gap-1.5">
      <span>{[owners, threshold].filter(Boolean).join(' · ')}</span>
      <Chips owners={after ?? []} added={change.added} removed={change.removed} />
    </span>
  )
}

function SignersView(props: {
  chainId: number
  safeTxHash: Hex
  signatures: Hex | undefined
  reading: boolean
  readError: Error | null
  sender: Address | undefined
  threshold: number | undefined
}) {
  const signers = useExecutedSigners(props.safeTxHash, props.signatures)
  if (!props.signatures) {
    if (props.readError)
      return <span className="text-destructive">{describeError(props.readError)}</span>
    if (props.reading)
      return <span className="text-muted-foreground">Reading the transaction…</span>
    // The transaction didn't call execTransaction on this Safe itself (a relayer or a batch did)
    return (
      <span className="text-muted-foreground">
        Executed via another contract: the signatures need tracing.
      </span>
    )
  }
  if (signers.error) return <span className="text-destructive">{describeError(signers.error)}</span>
  if (!signers.data) return <span className="text-muted-foreground">Recovering the signers…</span>
  const sender = props.sender?.toLowerCase()
  const note = (s: ExecutedSignature) => {
    const sent = s.signer?.toLowerCase() === sender && !!sender
    if (s.kind === 'approved')
      return sent ? 'sent it' : sender ? 'approved onchain' : 'pre-approved'
    if (s.kind === 'contract') return 'contract signature'
    if (s.kind === 'eth_sign') return 'eth_sign'
    return sent ? 'signed, and sent it' : undefined
  }
  return (
    <span className="flex flex-col gap-1">
      {signers.data.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: signatures keep their order in the bytes
        <span key={`${s.signer ?? 'unknown'}:${i}`} className="flex flex-wrap items-center gap-x-2">
          {s.signer ? (
            <AddressView chainId={props.chainId} address={s.signer} />
          ) : (
            <span className="text-muted-foreground">a signature that doesn't recover</span>
          )}
          {note(s) && <span className="text-muted-foreground">({note(s)})</span>}
        </span>
      ))}
      <span className="text-muted-foreground">
        {props.threshold !== undefined
          ? `${signers.data.length} of ${props.threshold} needed at the time`
          : plural(signers.data.length, 'signature')}
      </span>
    </span>
  )
}

/** Each call in plain words, amounts included where the token is known. */
function CallsView(props: {
  chainId: number
  safe: Address
  tx: SafeTx
  decoded: Decoded | undefined
}) {
  const { decoded } = props
  if (!decoded) return <span className="text-muted-foreground">Decoding…</span>
  if (decoded.kind === 'batch')
    return (
      <span className="flex flex-col gap-1">
        <ol className="flex flex-col gap-1">
          {decoded.calls.map(({ call, decoded: inner }, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: calls have no identity but their place
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground">{i + 1}</span>
              <CallLine chainId={props.chainId} safe={props.safe} call={call} decoded={inner} />
            </li>
          ))}
        </ol>
        <span className="text-muted-foreground">{decoded.source}, verified by code hash</span>
      </span>
    )
  return (
    <span className="flex flex-col gap-1">
      <CallLine chainId={props.chainId} safe={props.safe} call={props.tx} decoded={decoded} />
      {decoded.kind === 'abi' && (
        <span className="text-muted-foreground">
          on <Mono title={props.tx.to}>{target(props.tx.to, props.safe)}</Mono> · {decoded.source}
        </span>
      )}
      {decoded.kind === 'raw' && (
        <span className="text-muted-foreground">Unverified: raw calldata</span>
      )}
    </span>
  )
}

const target = (to: Address, safe: Address) =>
  getAddress(to) === getAddress(safe) ? 'this Safe' : shortAddress(to)

function CallLine(props: {
  chainId: number
  safe: Address
  call: BatchCall | SafeTx
  decoded: Decoded
}) {
  const { call, decoded, safe } = props
  const native = useNativeAmount(props.chainId)
  const erc20 =
    decoded.kind === 'abi' &&
    decoded.source.startsWith('ERC-20') &&
    ['transfer', 'approve', 'transferFrom'].includes(decoded.functionName)
  const universe = useTokenUniverse(props.chainId)
  const listed = erc20
    ? universe?.find((t) => t.address.toLowerCase() === call.to.toLowerCase())
    : undefined
  const meta = useTokenMeta(props.chainId, erc20 && universe && !listed ? call.to : undefined)
  const token = listed ?? meta.data
  const value = (v: unknown, type: string): ReactNode => {
    if (type === 'address' && typeof v === 'string')
      return <Mono title={v}>{target(v as Address, safe)}</Mono>
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'string' && v.startsWith('0x')) return <Mono>{shortData(v)}</Mono>
    if (Array.isArray(v)) return `[${plural(v.length, 'item')}]`
    if (typeof v === 'object' && v !== null) return '{…}'
    return String(v)
  }
  if (decoded.kind === 'empty')
    return getAddress(call.to) === getAddress(safe) && call.value === 0n ? (
      <span>Nothing: an empty call to this Safe</span>
    ) : (
      <span>
        Send {native(call.value)} to <Mono title={call.to}>{target(call.to, safe)}</Mono>
      </span>
    )
  if (decoded.kind === 'router')
    return <span>Universal Router: {plural(decoded.router.commands.length, 'command')}</span>
  if (decoded.kind === 'raw')
    return (
      <span>
        Unverified call to <Mono title={call.to}>{target(call.to, safe)}</Mono>
        {decoded.selector && (
          <>
            {' '}
            (selector <Mono>{decoded.selector}</Mono>)
          </>
        )}
      </span>
    )
  if (decoded.kind === 'batch') return <span>A nested batch of {decoded.calls.length} calls</span>
  if (erc20 && token) {
    const amount = decoded.args.find((x) => x.type === 'uint256')?.value as bigint | undefined
    const to = decoded.args.find(
      (x) => x.type === 'address' && x.name !== 'sender' && x.name !== 'from',
    )
    return (
      <span>
        {decoded.functionName}{' '}
        {amount === undefined
          ? '?'
          : amount === maxUint256
            ? 'unlimited'
            : formatUnits(amount, token.decimals)}{' '}
        {token.symbol} → {to ? value(to.value, 'address') : '?'}
      </span>
    )
  }
  if (decoded.inner)
    return (
      <span className="flex flex-col gap-1">
        <span>
          <Mono>{decoded.functionName}</Mono>, making {plural(decoded.inner.length, 'call')} on the
          same contract:
        </span>
        <ol className="flex flex-col gap-1 border-l pl-3">
          {decoded.inner.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: calls have no identity but their place
            <li key={i}>
              <CallLine
                chainId={props.chainId}
                safe={safe}
                call={{ to: call.to, value: 0n, data: c.data, operation: 0 }}
                decoded={c.decoded}
              />
            </li>
          ))}
        </ol>
      </span>
    )
  return (
    <span>
      <Mono>{decoded.functionName}</Mono>
      {decoded.args.map((x) => (
        <span key={x.name}>
          {' · '}
          <span className="text-muted-foreground">{x.name}</span> {value(x.value, x.type)}
        </span>
      ))}
    </span>
  )
}

/** The full decoding and every raw field, read only once opened. */
function HistoryDetails(props: { chainId: number; safe: Address; tx: SafeTx }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(ev) => setOpen(ev.currentTarget.open)} data-testid="history-details">
      <summary className="cursor-pointer underline underline-offset-4">
        Full decoding and raw fields
      </summary>
      {open && <HistoryDecoded {...props} />}
    </details>
  )
}

function HistoryDecoded({ chainId, safe, tx }: { chainId: number; safe: Address; tx: SafeTx }) {
  // The review screen's decoding: batches only on a MultiSend verified by code hash (SPEC §7.4)
  const { decoded, guess, inspection, remoteErrors } = useCallDecoding(chainId, safe, tx)
  if (!decoded) return <p className="my-3 text-sm text-muted-foreground">Decoding…</p>
  return (
    <div className="my-3 flex flex-col gap-3">
      {[inspection.error, ...remoteErrors].map(
        (err) =>
          err && (
            <p key={err.message} className="text-sm text-muted-foreground">
              {describeError(err)}
            </p>
          ),
      )}
      <DecodedView chainId={chainId} tx={tx} decoded={decoded} guess={guess} />
      <TxFields chainId={chainId} tx={tx} />
    </div>
  )
}

// A one-line summary computed from the decoded call (SPEC §3.4 item 2), used when there's no
// builder description. Clear signing (when it resolves) takes precedence later. Everything here
// comes from decoded calldata and the user's own token lists, never from descriptor text.
import { type Address, formatUnits, getAddress, type Hex, maxUint256 } from 'viem'
import { list, plural, shortAddress } from '@/lib/format'
import { isCancel } from './builders'
import type { Decoded } from './decode'
import type { SafeTx } from './safe-tx'

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
/** Quoted text from calldata, cut short so it can't take over the line. */
const quote = (s: unknown) => {
  const t = String(s)
  return `"${t.length > 40 ? `${t.slice(0, 40)}…` : t}"`
}

/** A token's symbol and decimals from the user's token lists, when it's in them. */
type TokenLookup = (address: string) => { symbol: string; decimals: number } | undefined

export function tokenLookup(
  tokens: readonly { address: string; symbol: string; decimals: number }[] | undefined,
): TokenLookup {
  const byAddress = new Map((tokens ?? []).map((t) => [t.address.toLowerCase(), t]))
  return (address) => byAddress.get(address.toLowerCase())
}

interface Call {
  readonly to: Address
  readonly value: bigint
  readonly operation?: 0 | 1
}

interface Context {
  readonly safe: Address
  readonly currency: { symbol: string; decimals: number }
  readonly tokens: TokenLookup
}

export function describeCall(
  tx: SafeTx,
  decoded: Decoded,
  safe: Address,
  currency: { symbol: string; decimals: number },
  tokens: TokenLookup = () => undefined,
): string {
  if (decoded.kind === 'empty' && isCancel(safe, tx))
    return `Cancel: an empty call that uses up nonce ${tx.nonce}`
  return describe(tx, decoded, { safe, currency, tokens })
}

function describe(call: Call, decoded: Decoded, ctx: Context): string {
  const who = (a: string) =>
    getAddress(a) === getAddress(ctx.safe) ? 'this Safe' : shortAddress(a)
  if (decoded.kind === 'empty')
    return `Send ${formatUnits(call.value, ctx.currency.decimals)} ${ctx.currency.symbol} to ${who(call.to)}`
  if (decoded.kind === 'raw') return `Unverified call to ${shortAddress(call.to)}`
  if (decoded.kind === 'batch') return describeBatch(decoded, ctx)
  if (decoded.kind === 'router') {
    const kinds = decoded.router.commands.map((c) => c.kind)
    const protocol = kinds.includes('v4-swap')
      ? 'v4'
      : kinds.includes('v3-swap-exact-in')
        ? 'v3'
        : ''
    return protocol
      ? `Swap on Uniswap ${protocol} through the Universal Router`
      : `Universal Router call (${plural(kinds.length, 'command')})`
  }
  const v = decoded.args.map((a) => a.value)
  if (getAddress(call.to) === getAddress(ctx.safe)) {
    switch (decoded.functionName) {
      case 'addOwnerWithThreshold':
        return `Add owner ${shortAddress(v[0] as string)} and set threshold to ${v[1]}`
      case 'removeOwner':
        return `Remove owner ${shortAddress(v[1] as string)} and set threshold to ${v[2]}`
      case 'swapOwner':
        return `Replace owner ${shortAddress(v[1] as string)} with ${shortAddress(v[2] as string)}`
      case 'changeThreshold':
        return `Change threshold to ${v[0]}`
    }
  }
  if (decoded.source.startsWith('ERC-20')) {
    const token = ctx.tokens(call.to)
    if (decoded.functionName === 'transfer')
      return token
        ? `Send ${amount(v[1] as bigint, token)} to ${who(v[0] as string)}`
        : `Transfer tokens (${shortAddress(call.to)}) to ${who(v[0] as string)}`
    if (decoded.functionName === 'approve' && token)
      return `Approve ${who(v[0] as string)} to spend ${amount(v[1] as bigint, token)}`
  }
  if (decoded.inner) return describeMulticall(call, decoded, ctx)
  if (decoded.source.startsWith('ENS')) {
    const ens = describeEns(decoded.functionName, decoded.signature, v, who)
    if (ens) return ens
  }
  return `Call ${decoded.functionName} on ${shortAddress(call.to)}`
}

const amount = (value: bigint, token: { symbol: string; decimals: number }) =>
  value === maxUint256
    ? `unlimited ${token.symbol}`
    : `${formatUnits(value, token.decimals)} ${token.symbol}`

// ---------- batches ----------

const OWNER_CALLS = new Set([
  'addOwnerWithThreshold',
  'removeOwner',
  'swapOwner',
  'changeThreshold',
])

function describeBatch(decoded: Extract<Decoded, { kind: 'batch' }>, ctx: Context): string {
  const calls = decoded.calls
  const plain = calls.every(({ call }) => call.operation === 0)
  const recipients = (addresses: readonly string[]) => {
    const distinct = [...new Set(addresses.map((a) => getAddress(a)))]
    return distinct.length === 1
      ? shortAddress(distinct[0] as string)
      : plural(distinct.length, 'address', 'addresses')
  }

  // The same token sent to one or more addresses
  const token = calls[0]?.call.to
  if (
    plain &&
    token &&
    calls.every(
      ({ call, decoded: d }) =>
        d.kind === 'abi' &&
        d.source.startsWith('ERC-20') &&
        d.functionName === 'transfer' &&
        getAddress(call.to) === getAddress(token) &&
        call.value === 0n,
    )
  ) {
    const args = calls.map(({ decoded: d }) => (d.kind === 'abi' ? d.args : []))
    const to = recipients(args.map((a) => String(a[0]?.value)))
    const known = ctx.tokens(token)
    if (!known) return `Send tokens (${shortAddress(token)}) to ${to}`
    const total = args.reduce((sum, a) => sum + (a[1]?.value as bigint), 0n)
    return `Send ${amount(total, known)} to ${to}`
  }

  // Native currency to one or more addresses
  if (plain && calls.every(({ call, decoded: d }) => d.kind === 'empty' && call.value > 0n)) {
    const total = calls.reduce((sum, { call }) => sum + call.value, 0n)
    return `Send ${formatUnits(total, ctx.currency.decimals)} ${ctx.currency.symbol} to ${recipients(calls.map(({ call }) => call.to))}`
  }

  // Owners and threshold, on this Safe
  if (
    plain &&
    calls.every(
      ({ call, decoded: d }) =>
        getAddress(call.to) === getAddress(ctx.safe) &&
        d.kind === 'abi' &&
        OWNER_CALLS.has(d.functionName),
    )
  ) {
    const added: string[] = []
    const removed: string[] = []
    const swapped: [string, string][] = []
    let threshold: unknown
    for (const { decoded: d } of calls) {
      if (d.kind !== 'abi') continue
      const v = d.args.map((a) => a.value)
      if (d.functionName === 'addOwnerWithThreshold') {
        added.push(v[0] as string)
        threshold = v[1]
      } else if (d.functionName === 'removeOwner') {
        removed.push(v[1] as string)
        threshold = v[2]
      } else if (d.functionName === 'swapOwner') swapped.push([v[1] as string, v[2] as string])
      else threshold = v[0]
    }
    const parts = [
      swapped.length === 1
        ? `replace owner ${shortAddress(swapped[0]?.[0] as string)} with ${shortAddress(swapped[0]?.[1] as string)}`
        : swapped.length
          ? `replace ${swapped.length} owners`
          : '',
      added.length === 1
        ? `add owner ${shortAddress(added[0] as string)}`
        : added.length
          ? `add ${added.length} owners`
          : '',
      removed.length === 1
        ? `remove owner ${shortAddress(removed[0] as string)}`
        : removed.length
          ? `remove ${removed.length} owners`
          : '',
      threshold !== undefined ? `set threshold to ${threshold}` : '',
    ].filter(Boolean)
    return capital(list(parts))
  }

  const parts = calls.map(({ call, decoded: d }) => lower(describe(call, d, ctx)))
  const n = parts.length
  return `Batch of ${plural(n, 'call')}: ${parts.slice(0, 2).join('; ')}${n > 2 ? '; …' : ''}`
}

// ---------- ENS ----------

/** SLIP-44 coin types an ENS name commonly holds (ENSIP-9). */
const COINS: Readonly<Record<string, string>> = {
  '0': 'BTC',
  '2': 'LTC',
  '3': 'DOGE',
  '60': 'ETH',
  '61': 'ETC',
  '145': 'BCH',
  '501': 'SOL',
}

/** ENSIP-9 and ENSIP-11 coin types. */
function coinName(coinType: bigint): string {
  const known = COINS[coinType.toString()]
  if (known) return known
  if (coinType === 0x80000000n) return 'default EVM'
  if (coinType > 0x80000000n) return `chain ${coinType - 0x80000000n}`
  return `coin type ${coinType}`
}

function describeEns(
  fn: string,
  signature: string,
  v: readonly unknown[],
  who: (a: string) => string,
): string | undefined {
  // ENS counts a year as 365.25 days: 5 years is 157,766,400 seconds
  const days = (seconds: unknown) => {
    const d = Number(BigInt(seconds as bigint) / 86_400n)
    if (d < 365) return plural(d, 'day')
    const years = Math.round((d / 365.25) * 10) / 10
    return `${years} year${years === 1 ? '' : 's'}`
  }
  switch (signature) {
    case 'setAddr(bytes32,address)':
      return `Set a name's ETH address to ${who(v[1] as string)}`
    case 'setAddr(bytes32,uint256,bytes)': {
      const coin = coinName(v[1] as bigint)
      const bytes = v[2] as Hex
      if (bytes === '0x') return `Clear a name's ${coin} address`
      return `Set a name's ${coin} address to ${bytes.length === 42 ? who(bytes) : `${bytes.slice(0, 10)}…`}`
    }
    case 'setText(bytes32,string,string)':
      return `Set a name's ${quote(v[1])} text record`
    case 'setContenthash(bytes32,bytes)':
      return v[1] === '0x' ? "Clear a name's contenthash" : "Set a name's contenthash"
    case 'setName(string)':
      return `Set this Safe's primary name to ${quote(v[0])}`
    case 'setName(bytes32,string)':
      return `Set a name record to ${quote(v[1])}`
    case 'setSubnodeRecord(bytes32,bytes32,address,address,uint64)':
      return `Create or update a subname, owned by ${who(v[2] as string)}`
    case 'setSubnodeRecord(bytes32,string,address,address,uint64,uint32,uint64)':
      return `Create or update the subname ${quote(v[1])}, owned by ${who(v[2] as string)}`
    case 'setSubnodeOwner(bytes32,bytes32,address)':
      return `Set a subname's owner to ${who(v[2] as string)}`
    case 'setSubnodeOwner(bytes32,string,address,uint32,uint64)':
      return `Set the owner of subname ${quote(v[1])} to ${who(v[2] as string)}`
    case 'setResolver(bytes32,address)':
      return `Set a name's resolver to ${who(v[1] as string)}`
    case 'setOwner(bytes32,address)':
      return `Set a name's owner to ${who(v[1] as string)}`
    case 'setRecord(bytes32,address,address,uint64)':
      return `Set a name's owner to ${who(v[1] as string)} and resolver to ${who(v[2] as string)}`
    case 'renew(string,uint256)':
    case 'renew(string,uint256,bytes32)':
      return `Renew ${quote(`${v[0]}.eth`)} for ${days(v[1])}`
    case 'register(string,address,uint256,bytes32,address,bytes[],bool,uint16)':
      return `Register ${quote(`${v[0]}.eth`)} for ${who(v[1] as string)}, ${days(v[2])}`
    case 'register(tuple)': {
      const r = v[0] as { label: string; owner: string; duration: bigint }
      return `Register ${quote(`${r.label}.eth`)} for ${who(r.owner)}, ${days(r.duration)}`
    }
  }
  if (fn === 'commit') return 'Commit to registering a .eth name'
  return undefined
}

/** A multicall reads as the calls it makes; setAddr calls to one address are put together. */
function describeMulticall(
  call: Call,
  decoded: Extract<Decoded, { kind: 'abi' }>,
  ctx: Context,
): string {
  const inner = decoded.inner ?? []
  const self = { to: call.to, value: 0n }
  if (inner.length === 0 || inner.some((c) => c.decoded.kind === 'raw'))
    return `Call ${decoded.functionName} on ${shortAddress(call.to)} (${plural(inner.length, 'call')})`
  const setAddrs = inner.flatMap(({ decoded: d }) =>
    d.kind === 'abi' &&
    d.source.startsWith('ENS') &&
    d.signature === 'setAddr(bytes32,uint256,bytes)'
      ? [{ coin: coinName(d.args[1]?.value as bigint), to: String(d.args[2]?.value).toLowerCase() }]
      : [],
  )
  const first = setAddrs[0]
  if (
    first &&
    setAddrs.length === inner.length &&
    setAddrs.every((s) => s.to === first.to) &&
    first.to.length === 42
  ) {
    const to = getAddress(first.to) === getAddress(ctx.safe) ? 'this Safe' : shortAddress(first.to)
    return `Set a name's ${list(setAddrs.map((s) => s.coin))} address${setAddrs.length > 1 ? 'es' : ''} to ${to}`
  }
  const parts = inner.map(({ decoded: d }) => describe(self, d, ctx))
  const shown = parts
    .slice(0, 2)
    .map((p, i) => (i ? lower(p) : p))
    .join('; ')
  return parts.length <= 2 ? shown : `${shown}; and ${plural(parts.length - 2, 'more call')}`
}

// A Universal Router call on the review screen, command by command (SPEC §3.13, §7.1 level 3).
// Computed from the decoded calldata only; recipients are labeled relative to this Safe.
import type { Address } from 'viem'
import { AddressView } from '@/components/address'
import {
  ADDRESS_THIS,
  ETH,
  MSG_SENDER,
  type Route,
  type RouterCall,
  type RouterCommand,
  type V4Action,
} from '@/core/uniswap'
import { formatAmount } from '@/features/balances/format'
import { sameAddress, shortAddress } from '@/lib/format'
import { routeText, useCoin, useSymbols } from './coins'

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

interface Ctx {
  readonly chainId: number
  readonly safe: Address | undefined
  /** The Verify page: nothing is read over RPC. */
  readonly offline: boolean
}

function Amount({ ctx, token, amount }: { ctx: Ctx; token: Address; amount: bigint }) {
  const coin = useCoin(ctx.chainId, token, ctx.offline)
  return (
    <span className="font-medium">
      {coin
        ? `${formatAmount(amount, coin.decimals)} ${coin.symbol}`
        : `${amount.toString()} base units of ${shortAddress(token)}`}
    </span>
  )
}

function Recipient({ ctx, address }: { ctx: Ctx; address: Address }) {
  if (sameAddress(address, MSG_SENDER)) return <span>the caller (this Safe)</span>
  if (sameAddress(address, ADDRESS_THIS)) return <span>the router, for the next command</span>
  const mine = !!ctx.safe && sameAddress(address, ctx.safe)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <AddressView chainId={ctx.chainId} address={address} />
      {mine ? (
        <span className="text-muted-foreground">(this Safe)</span>
      ) : (
        <span className="font-medium text-destructive">not this Safe</span>
      )}
    </span>
  )
}

function RouteLine({ ctx, route }: { ctx: Ctx; route: Route }) {
  const symbol = useSymbols(ctx.chainId)
  return <span className="font-mono text-xs">{routeText(route, symbol)}</span>
}

function Swap(props: {
  ctx: Ctx
  route: Route
  amountIn: bigint
  minOut: bigint
  standardPools?: boolean
}) {
  const { ctx, route } = props
  return (
    <>
      Swap <Amount ctx={ctx} token={route.path[0]} amount={props.amountIn} /> for at least{' '}
      <Amount ctx={ctx} token={route.path[route.path.length - 1]} amount={props.minOut} />
      <br />
      <RouteLine ctx={ctx} route={route} />
      {props.standardPools === false && (
        <span className="block text-destructive">
          Uses a pool with hooks or a non-standard tick spacing.
        </span>
      )}
    </>
  )
}

function V4Step({ ctx, action }: { ctx: Ctx; action: V4Action }) {
  switch (action.kind) {
    case 'swap-exact-in':
    case 'swap-exact-in-single':
      return (
        <Swap
          ctx={ctx}
          route={action.route}
          amountIn={action.amountIn}
          minOut={action.amountOutMinimum}
          standardPools={action.standardPools}
        />
      )
    case 'settle-all':
      return (
        <>
          Pay up to <Amount ctx={ctx} token={action.currency} amount={action.maxAmount} /> from this
          Safe
        </>
      )
    case 'take-all':
      return (
        <>
          Take at least <Amount ctx={ctx} token={action.currency} amount={action.minAmount} />, to
          the caller (this Safe)
        </>
      )
    default:
      return <span className="text-destructive">Action {hex(action.action)}, not decoded</span>
  }
}

function Command({ ctx, command }: { ctx: Ctx; command: RouterCommand }) {
  switch (command.kind) {
    case 'v3-swap-exact-in':
      return (
        <>
          <span className="text-muted-foreground">Uniswap v3 · </span>
          <Swap
            ctx={ctx}
            route={command.route}
            amountIn={command.amountIn}
            minOut={command.amountOutMin}
          />
          <br />
          Paid by{' '}
          {command.payerIsUser ? 'this Safe, through Permit2' : 'the router (an earlier command)'},
          to <Recipient ctx={ctx} address={command.recipient} />
        </>
      )
    case 'wrap-eth':
      return (
        <>
          Wrap <Amount ctx={ctx} token={ETH} amount={command.amount} /> into WETH, to{' '}
          <Recipient ctx={ctx} address={command.recipient} />
        </>
      )
    case 'unwrap-weth':
      return (
        <>
          Unwrap the router's WETH into at least{' '}
          <Amount ctx={ctx} token={ETH} amount={command.amountMin} />, to{' '}
          <Recipient ctx={ctx} address={command.recipient} />
        </>
      )
    case 'sweep':
      return (
        <>
          Send the router's <Amount ctx={ctx} token={command.token} amount={command.amountMin} /> or
          more, to <Recipient ctx={ctx} address={command.recipient} />
        </>
      )
    case 'v4-swap':
      return (
        <>
          <span className="text-muted-foreground">Uniswap v4, in order:</span>
          <ol className="mt-1 ml-4 list-decimal">
            {command.actions.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional and fixed
              <li key={i}>
                <V4Step ctx={ctx} action={a} />
              </li>
            ))}
          </ol>
        </>
      )
    default:
      return <span className="text-destructive">Command {hex(command.command)}, not decoded</span>
  }
}

export function RouterCommands(props: {
  chainId: number
  safe: Address | undefined
  router: RouterCall
  offline?: boolean
}) {
  const ctx: Ctx = { chainId: props.chainId, safe: props.safe, offline: !!props.offline }
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="router-commands">
      <ol className="flex flex-col gap-2">
        {props.router.commands.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: commands are positional and fixed
          <li key={i} className="rounded-md bg-muted/50 p-2">
            <span className="mr-1 text-muted-foreground">{i + 1}.</span>
            <Command ctx={ctx} command={c} />
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground">
        Deadline: {new Date(Number(props.router.deadline) * 1000).toLocaleString()}. After this, the
        router refuses the call.
      </p>
    </div>
  )
}

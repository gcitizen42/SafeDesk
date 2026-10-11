// Creating a Safe over our RPC (SPEC §3.14). The wallet only signs and sends.
import { Data, Effect, Schedule } from 'effect'
import { type Address, decodeFunctionResult, isAddressEqual, keccak256 } from 'viem'
import { type CreationPlan, proxyFactoryAbi } from '@/core/create-safe'
import { isRevert, revertData, translateRevert } from '@/core/execution'
import { endpointOf, Rpc, rpcCall } from '@/effect/rpc'
import { rpcFailure } from '@/effect/rpc-failure'
import { loadSafe } from './load-safe'

class CreationUnavailable extends Data.TaggedError('CreationUnavailable')<{
  readonly message: string
}> {}

/**
 * Before the wallet sees anything: the factory, singleton and fallback handler must be Safe's
 * official contracts (by code hash), nothing may exist at the predicted address yet, and the
 * factory, called exactly as the wallet will call it, must create that address. With `from`,
 * also estimates gas.
 */
export const checkCreation = (plan: CreationPlan, from?: Address) =>
  Effect.gen(function* () {
    const rpc = yield* Rpc
    const settings = yield* rpc.chain(plan.chainId)
    const client = yield* rpc.client(plan.chainId, 'create')
    const endpoint = endpointOf(settings)
    const { version, factory, singleton, fallbackHandler } = plan.contracts
    const contracts = [
      [`SafeProxyFactory ${version}`, factory],
      [`${singleton.contractName} ${version}`, singleton],
      [`CompatibilityFallbackHandler ${version}`, fallbackHandler],
    ] as const
    const [codes, existing] = yield* rpcCall(endpoint, () =>
      Promise.all([
        Promise.all(contracts.map(([, c]) => client.getCode({ address: c.address }))),
        client.getCode({ address: plan.address }),
      ]),
    )
    const wrong = contracts.filter(([, c], i) => {
      const code = codes[i]
      return !code || code === '0x' || keccak256(code) !== c.codeHash.toLowerCase()
    })
    if (wrong.length > 0)
      return yield* new CreationUnavailable({
        message: `${settings.name} doesn't have Safe's official ${wrong.map(([name, c]) => `${name} (${c.address})`).join(', ')}. Plain Safe only creates Safes from Safe's own deployments, checked by code hash.`,
      })
    if (existing && existing !== '0x')
      return yield* new CreationUnavailable({
        message: `There's already a contract at ${plan.address}.`,
      })

    const fails = (e: unknown) =>
      isRevert(e)
        ? new CreationUnavailable({
            message: `Creating this Safe would fail. ${translateRevert(revertData(e), proxyFactoryAbi)}`,
          })
        : rpcFailure(endpoint)(e)
    const result = yield* Effect.tryPromise({
      try: () => client.call({ ...(from ? { account: from } : {}), to: plan.to, data: plan.data }),
      catch: fails,
    })
    const created = decodeFunctionResult({
      abi: proxyFactoryAbi,
      functionName: 'createProxyWithNonce',
      data: result.data ?? '0x',
    })
    if (!isAddressEqual(created, plan.address))
      return yield* new CreationUnavailable({
        message: `The factory would create ${created}, not the predicted ${plan.address}.`,
      })
    const gas = from
      ? yield* Effect.tryPromise({
          try: () => client.estimateGas({ account: from, to: plan.to, data: plan.data }),
          catch: fails,
        })
      : undefined
    return { gas }
  })

/** The new Safe, read and checked like any added Safe (§3.2). The RPC may lag the receipt. */
export const loadCreatedSafe = (chainId: number, address: Address) =>
  loadSafe(chainId, address).pipe(
    Effect.retry({
      times: 5,
      schedule: Schedule.spaced('2 seconds'),
      while: (e) => e._tag === 'NotAContract',
    }),
  )

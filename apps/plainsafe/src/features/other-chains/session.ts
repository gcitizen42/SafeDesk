import {
  blankInputs,
  inspectInput,
  parseInspection,
  parsePlan,
  parseSimulation,
  planInput,
  type SuiInputs,
  type SuiInspection,
  type SuiPlan,
  type SuiSimulation,
  selectableObject,
  targetPolicyJson,
} from './model'

type Action = 'inspect' | 'plan' | 'simulate'
export interface SuiState {
  readonly inputs: SuiInputs
  readonly revision: number
  readonly busy?: Action
  readonly inspection?: SuiInspection
  readonly plan?: SuiPlan
  readonly simulation?: SuiSimulation
  readonly error?: string
}
export type SuiRequest = (action: Action, body: unknown, signal: AbortSignal) => Promise<unknown>

const ENDPOINTS: Record<Action, string> = {
  inspect: '/api/other-chains/sui/inspect',
  plan: '/api/other-chains/sui/plan',
  simulate: '/api/other-chains/sui/simulate',
}
class SuiGuardError extends Error {}

const GUARD_PREFIXES = [
  'An incoming owner public key could not be resolved from bounded history.',
  'The public policy does not derive the expected vault address.',
  'A complete inventory and source public policy verified against the vault are required.',
  'The supplied signer is not in the source public policy.',
  'No reserved SUI coin covers the gas budget.',
  'Object version, ownership or gas changed.',
  'Gas price changed.',
  'Rebuild a fresh migration package before simulation.',
  'MSafe specifier and creation nonce differ.',
  'MSafe accepts at most nine owners plus its account specifier.',
  'Destination policy is unchanged;',
  'Administrative capability transfers require explicit acknowledgement.',
  'Confirm that destination keys,',
  'An other-chain operation is already running.',
  'No supported multisig public policy matches this vault in the evidence.',
  'Evidence must be a successful outgoing transaction from this vault.',
  'An owner address does not match its public key.',
]
function guardMessage(input: unknown): string | undefined {
  if (
    typeof input !== 'string' ||
    input.length > 512 ||
    /https?:|wss?:|\b(?:stack|password|secret|token)\b/i.test(input)
  )
    return
  return GUARD_PREFIXES.some((prefix) => input.startsWith(prefix)) ? input : undefined
}
export const requestSui: SuiRequest = async (action, body, signal) => {
  const response = await fetch(ENDPOINTS[action], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-SafeDesk-Readonly': '1',
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    mode: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    let detail: unknown
    try {
      detail = await response.json()
    } catch {
      /* Unstructured errors stay generic. */
    }
    const allowed = guardMessage(
      detail && typeof detail === 'object' ? (detail as { error?: unknown }).error : undefined,
    )
    if (allowed) throw new SuiGuardError(allowed)
    throw new Error('Sui request could not be completed.')
  }
  return response.json()
}

const problem = (operation: () => unknown): string | undefined => {
  try {
    operation()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'Input is invalid.'
  }
}
export function suiAvailability(state: SuiState, now = Date.now()) {
  const age = state.plan ? now - Date.parse(state.plan.createdAt) : Number.POSITIVE_INFINITY
  const planCurrent = !!state.plan && age >= -1000 && age <= 15 * 60 * 1000
  return {
    inspectProblem: problem(() => inspectInput(state.inputs)),
    buildProblem: problem(() => planInput(state.inputs, state.inspection)),
    targetProblem: state.inputs.targetPolicyJson.trim()
      ? problem(() => targetPolicyJson(state.inputs.targetPolicyJson, state.inputs.targetThreshold))
      : undefined,
    planCurrent,
    reviewable: !!state.plan && !state.busy,
    simulationReviewable:
      planCurrent &&
      !state.busy &&
      !!state.simulation &&
      state.simulation.packageHash === state.plan?.packageHash &&
      state.simulation.transactionDigest === state.plan?.transactionDigest,
    exportable:
      planCurrent &&
      !state.busy &&
      state.simulation?.status === 'passed' &&
      state.simulation.gasPaymentMocked === false &&
      state.simulation.packageHash === state.plan?.packageHash &&
      state.simulation.transactionDigest === state.plan?.transactionDigest,
  }
}

/** A per-screen memory session; revision and request identity gate every asynchronous result. */
export function createSuiSession(request: SuiRequest = requestSui) {
  let state: SuiState = { inputs: { ...blankInputs, objectIds: [] }, revision: 0 }
  let active: { id: symbol; controller: AbortController } | undefined
  const listeners = new Set<() => void>()
  const publish = (next: SuiState) => {
    state = next
    for (const notify of listeners) notify()
  }
  const cancel = () => {
    active?.controller.abort()
    active = undefined
    if (state.busy) publish({ ...state, busy: undefined, revision: state.revision + 1 })
  }

  const edit = (patch: Partial<SuiInputs>) => {
    active?.controller.abort()
    active = undefined
    const identityChanged = ['vault', 'signer', 'evidenceDigest', 'sourcePolicyJson'].some(
      (key) => key in patch,
    )
    const targetChanged = 'targetPolicyJson' in patch || 'targetThreshold' in patch
    let inputs = { ...state.inputs, ...patch }
    if (identityChanged)
      inputs = { ...inputs, objectIds: [], ackPrivileged: false, ackDestination: false }
    if (targetChanged) inputs = { ...inputs, ackDestination: false }
    if (patch.ackPrivileged === false)
      inputs = {
        ...inputs,
        objectIds: inputs.objectIds.filter(
          (id) => state.inspection?.objects.find((o) => o.objectId === id)?.kind !== 'privileged',
        ),
      }
    publish({
      inputs,
      revision: state.revision + 1,
      ...(identityChanged ? {} : { inspection: state.inspection }),
    })
  }

  async function perform<T>(
    action: Action,
    body: unknown,
    decode: (value: unknown) => T,
    receive: (value: T) => Partial<SuiState>,
  ) {
    if (active) return
    const id = Symbol(action)
    const controller = new AbortController()
    active = { id, controller }
    const revision = state.revision
    publish({
      ...state,
      busy: action,
      error: undefined,
      ...(action === 'inspect'
        ? {
            inspection: undefined,
            plan: undefined,
            simulation: undefined,
            inputs: { ...state.inputs, objectIds: [] },
          }
        : {}),
      ...(action === 'plan' ? { plan: undefined, simulation: undefined } : {}),
      ...(action === 'simulate' ? { simulation: undefined } : {}),
    })
    const current = () =>
      active?.id === id && state.revision === revision && !controller.signal.aborted
    try {
      const input = await request(action, body, controller.signal)
      if (!current()) return
      const value = decode(input)
      if (current()) publish({ ...state, ...receive(value), error: undefined })
    } catch (error) {
      if (current())
        publish({
          ...state,
          error:
            error instanceof SuiGuardError
              ? error.message
              : 'Sui request could not be completed. Try again.',
        })
    } finally {
      if (current()) {
        active = undefined
        publish({ ...state, busy: undefined })
      }
    }
  }

  const inspect = async () => {
    if (active) return
    let body: ReturnType<typeof inspectInput>
    try {
      body = inspectInput(state.inputs)
    } catch (error) {
      publish({ ...state, error: error instanceof Error ? error.message : 'Invalid source input.' })
      return
    }
    await perform(
      'inspect',
      body,
      (value) => parseInspection(value, body),
      (inspection) => ({ inspection }),
    )
  }
  const build = async () => {
    if (active) return
    let body: ReturnType<typeof planInput>
    try {
      body = planInput(state.inputs, state.inspection)
    } catch (error) {
      publish({
        ...state,
        error: error instanceof Error ? error.message : 'Invalid migration input.',
      })
      return
    }
    await perform(
      'plan',
      body,
      (value) => parsePlan(value, body),
      (plan) => ({ plan }),
    )
  }
  const simulate = async () => {
    const plan = state.plan
    if (!plan || active) return
    if (!suiAvailability(state).planCurrent) {
      publish({ ...state, error: 'Migration package expired. Build a fresh package.' })
      return
    }
    await perform(
      'simulate',
      { package: plan },
      (value) => parseSimulation(value, plan),
      (simulation) => ({ simulation }),
    )
  }
  return {
    getSnapshot: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    edit,
    inspect,
    build,
    simulate,
    cancel,
    toggleObject: (id: string, checked: boolean) => {
      const object = state.inspection?.objects.find((o) => o.objectId === id)
      if (!object || !selectableObject(object, state.inputs.ackPrivileged)) return
      edit({
        objectIds: checked
          ? [...new Set([...state.inputs.objectIds, id])]
          : state.inputs.objectIds.filter((selected) => selected !== id),
      })
    },
  }
}
export type SuiSession = ReturnType<typeof createSuiSession>

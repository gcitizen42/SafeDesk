// Safety rules (SPEC §7.4). Computed from the decoded transaction and chain facts only, never
// from clear-signing descriptor text.
import { type Address, type Hex, zeroAddress } from 'viem'
import { sameAddress } from '@/lib/format'
import type { Decoded } from './decode'
import type { SafeTx } from './safe-tx'
import {
  ADDRESS_THIS,
  leavesFundsInRouter,
  MSG_SENDER,
  routerRecipients,
  undecodedRouterParts,
} from './uniswap'

export type Severity = 'red' | 'orange' | 'yellow' | 'info'

export interface Banner {
  /** Which call in a batch this is about (1-based); absent for the Safe transaction itself. */
  readonly call?: number
  readonly rule:
    | 'delegatecall'
    | 'owner-change'
    | 'undecoded'
    | 'refund'
    | 'nonce'
    | 'target-no-code'
    | 'selector-missing'
    | 'unsupported-safe'
    | 'swap-recipient'
    | 'swap-leftover'
    | 'swap-undecoded'
  readonly severity: Severity
  readonly title: string
  readonly body: string
}

export interface SafetyInput {
  readonly safe: Address
  readonly tx: SafeTx
  readonly decoded: Decoded
  /** Safe authenticity: anything but 'verified' refuses signing. */
  readonly safeVerified: boolean
  readonly onchainNonce?: bigint
  /** The target's own code hash matches a MultiSend or MultiSendCallOnly (SPEC §4.2). */
  readonly targetIsVerifiedMultiSend: boolean
  /** From whatsabi, when available. */
  readonly target?: TargetFacts
  /** For batches: whatsabi facts about each inner call's target, by lowercase address. */
  readonly innerTargets?: ReadonlyMap<
    string,
    TargetFacts & { readonly isVerifiedMultiSend: boolean }
  >
}

export interface TargetFacts {
  readonly hasCode: boolean
  readonly selectors: ReadonlySet<string>
  readonly isDelegatedEoa: boolean
}

interface Call {
  readonly to: Address
  readonly value: bigint
  readonly data: Hex
  readonly operation: 0 | 1
}

/** Calls on the Safe that change who controls it. */
const CONTROL_FUNCTIONS = new Set([
  'addOwnerWithThreshold',
  'removeOwner',
  'swapOwner',
  'changeThreshold',
  'enableModule',
  'disableModule',
  'setGuard',
  'setModuleGuard',
  'setFallbackHandler',
])

const SEVERITY_ORDER: Record<Severity, number> = { red: 0, orange: 1, yellow: 2, info: 3 }

/**
 * The rules that apply to any one call: the Safe transaction itself, or each call in a batch
 * (SPEC §7.4).
 */
function callBanners(
  safe: Address,
  call: Call,
  decoded: Decoded,
  targetIsVerifiedMultiSend: boolean,
  target: TargetFacts | undefined,
): Banner[] {
  const out: Banner[] = []
  const toSafe = call.to.toLowerCase() === safe.toLowerCase()

  if (call.operation === 1 && !targetIsVerifiedMultiSend) {
    out.push({
      rule: 'delegatecall',
      severity: 'red',
      title: 'DELEGATECALL to an unknown contract',
      body: `DELEGATECALL runs ${call.to}'s code with this Safe's storage and funds. It can take over this Safe. Only sign if you know exactly why this is needed.`,
    })
  }

  if (
    toSafe &&
    call.operation === 0 &&
    decoded.kind === 'abi' &&
    CONTROL_FUNCTIONS.has(decoded.functionName)
  ) {
    out.push({
      rule: 'owner-change',
      severity: 'orange',
      title: 'Changes who controls this Safe',
      body:
        decoded.functionName.includes('Owner') || decoded.functionName === 'changeThreshold'
          ? 'This changes the owners or the threshold. Check the before → after view carefully.'
          : `This calls ${decoded.functionName}, which changes the Safe's modules, guard or fallback handler.`,
    })
  }

  if (decoded.kind === 'raw') {
    out.push({
      rule: 'undecoded',
      severity: 'yellow',
      title: 'Unverified: raw calldata',
      body: 'This calldata could not be decoded with a known ABI. What it does can only be judged from the raw bytes.',
    })
  }

  // Universal Router calls (SPEC §3.13): from the decoded commands, never from descriptor text
  if (decoded.kind === 'router') {
    const elsewhere = [
      ...new Set(
        routerRecipients(decoded.router)
          .filter(
            (r) =>
              !sameAddress(r, safe) && !sameAddress(r, MSG_SENDER) && !sameAddress(r, ADDRESS_THIS),
          )
          .map((r) => r.toLowerCase()),
      ),
    ]
    if (elsewhere.length)
      out.push({
        rule: 'swap-recipient',
        severity: 'red',
        title: 'Swap output goes to another address',
        body: `The router sends tokens to ${elsewhere.join(', ')}, not to this Safe. Only sign if you mean to pay that address.`,
      })
    if (leavesFundsInRouter(decoded.router))
      out.push({
        rule: 'swap-leftover',
        severity: 'red',
        title: 'Leaves tokens in the router',
        body: 'A command sends its output to the router itself and nothing collects it afterwards. Whoever calls the router next can take those tokens.',
      })
    const unknown = undecodedRouterParts(decoded.router)
    if (unknown.length)
      out.push({
        rule: 'swap-undecoded',
        severity: 'yellow',
        title: 'Router commands Plain Safe does not decode',
        body: `This router call includes ${[...new Set(unknown)].join(', ')}. What that part does can only be judged from the raw bytes.`,
      })
  }

  if (target && call.data !== '0x') {
    if (!target.hasCode) {
      out.push({
        rule: 'target-no-code',
        severity: 'yellow',
        title: 'Target has no code (an EOA)',
        body: 'This transaction sends calldata to an address with no contract code, so the calldata does nothing.',
      })
    } else if (!target.isDelegatedEoa && call.data.length >= 10) {
      const selector = call.data.slice(0, 10).toLowerCase() as Hex
      if (!target.selectors.has(selector)) {
        out.push({
          rule: 'selector-missing',
          severity: 'yellow',
          title: `Function ${selector} is not in the target's bytecode`,
          body: 'The called function was not found in the contract (after following proxies). The call may hit a fallback, or revert.',
        })
      }
    }
  }
  return out
}

export function safetyBanners(input: SafetyInput): Banner[] {
  const { tx, decoded } = input
  const out: Banner[] = []

  if (!input.safeVerified) {
    out.push({
      rule: 'unsupported-safe',
      severity: 'red',
      title: 'This Safe could not be verified',
      body: 'Its code does not match a known, supported Safe release, so signing is refused.',
    })
  }

  out.push(
    ...callBanners(
      input.safe,
      tx,
      decoded,
      input.targetIsVerifiedMultiSend,
      // A batch's own calldata is multiSend(bytes); its calls are checked one by one below.
      decoded.kind === 'batch' ? undefined : input.target,
    ),
  )
  if (decoded.kind === 'batch') {
    decoded.calls.forEach(({ call, decoded: inner }, i) => {
      const facts = input.innerTargets?.get(call.to.toLowerCase())
      for (const b of callBanners(
        input.safe,
        call,
        inner,
        facts?.isVerifiedMultiSend ?? false,
        facts,
      )) {
        out.push({
          ...b,
          call: i + 1,
          title: `Call ${i + 1} of ${decoded.calls.length}: ${b.title}`,
        })
      }
    })
  }

  if (
    tx.gasPrice !== 0n ||
    tx.gasToken.toLowerCase() !== zeroAddress ||
    tx.refundReceiver.toLowerCase() !== zeroAddress
  ) {
    out.push({
      rule: 'refund',
      severity: 'yellow',
      title: 'Gas refund fields are set',
      body: `The executor is paid from the Safe: up to (baseGas + gas used) × gasPrice ${tx.gasPrice.toString()} in ${tx.gasToken === zeroAddress ? 'the native currency' : tx.gasToken}, sent to ${tx.refundReceiver === zeroAddress ? 'whoever executes' : tx.refundReceiver}. A malicious combination can drain funds.`,
    })
  }

  if (input.onchainNonce !== undefined && tx.nonce !== input.onchainNonce) {
    out.push({
      rule: 'nonce',
      severity: 'info',
      title:
        tx.nonce < input.onchainNonce
          ? `Nonce ${tx.nonce} is already used`
          : `Nonce ${tx.nonce} is in the future`,
      body:
        tx.nonce < input.onchainNonce
          ? `The Safe's nonce is ${input.onchainNonce}. This transaction can never execute.`
          : `The Safe's nonce is ${input.onchainNonce}. This transaction waits until nonces ${input.onchainNonce}–${tx.nonce - 1n} execute, or replaces a queued one with the same nonce.`,
    })
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** Signing is refused outright for an unverified Safe (SPEC §4.1). */
export const signingRefused = (banners: readonly Banner[]) =>
  banners.some((b) => b.rule === 'unsupported-safe')
/** A red delegatecall banner needs a typed confirmation (SPEC §7.4). */
export const needsTypedConfirmation = (banners: readonly Banner[]) =>
  banners.some((b) => b.rule === 'delegatecall')
/** The main button reads "Sign unverified transaction" (SPEC §7.4). */
export const isUnverified = (banners: readonly Banner[]) =>
  banners.some((b) => b.rule === 'undecoded')

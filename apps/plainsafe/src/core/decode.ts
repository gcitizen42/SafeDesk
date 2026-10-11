// ABI decoding for the renderer (SPEC §7.1 levels 3 to 5). Clear signing (levels 1–2) layers on
// top; this never looks at descriptor text.

import {
  type Abi,
  type AbiFunction,
  decodeFunctionData,
  type Hex,
  parseAbiItem,
  slice,
  toFunctionSelector,
} from 'viem'
import { type BatchCall, decodeMultiSend } from './multisend'
import type { RouterCall } from './uniswap'

interface DecodedArg {
  readonly name: string
  readonly type: string
  readonly value: unknown
}

export type Decoded =
  | { readonly kind: 'empty' } // data = 0x: a plain value transfer
  | {
      readonly kind: 'abi'
      readonly level: 3
      readonly source: string
      readonly functionName: string
      readonly signature: string
      readonly args: readonly DecodedArg[]
      /**
       * multicall(bytes[]): the calls it makes on the same contract, each decoded with the same
       * ABIs and the same bytecode check.
       */
      readonly inner?: readonly { readonly data: Hex; readonly decoded: Decoded }[]
    }
  | { readonly kind: 'raw'; readonly level: 5; readonly selector?: Hex }
  | {
      /** multiSend(bytes) on a MultiSend verified by code hash, each call decoded in turn. */
      readonly kind: 'batch'
      readonly level: 3
      readonly source: string
      readonly calls: readonly { readonly call: BatchCall; readonly decoded: Decoded }[]
    }
  | {
      /** execute() on this chain's Universal Router, decoded command by command (SPEC §3.13). */
      readonly kind: 'router'
      readonly level: 3
      readonly source: string
      readonly router: RouterCall
    }

interface AbiSource {
  readonly source: string
  readonly abi: Abi | readonly unknown[]
}

/**
 * Functions that call their own contract once per element of a bytes[] argument (OpenZeppelin's
 * and ENS resolvers' Multicallable): their calls are decoded against the same contract.
 */
const SELF_MULTICALLS = new Set(['multicall', 'multicallWithNodeCheck'])
/** A multicall inside a multicall is decoded; one level deeper isn't. */
const MAX_MULTICALL_DEPTH = 2

/** Each argument with its ABI name, or arg0, arg1… when the ABI has none. */
const namedArgs = (fn: AbiFunction, values: readonly unknown[] | undefined): DecodedArg[] =>
  fn.inputs.map((p, i) => ({ name: p.name || `arg${i}`, type: p.type, value: values?.[i] }))

/**
 * Decode `data` with the first source that has a matching function. When `selectorsInBytecode`
 * is given, functions whose selector isn't in the target's current bytecode are not used
 * (SPEC §7.3).
 */
export function decodeCalldata(
  data: Hex,
  sources: readonly AbiSource[],
  selectorsInBytecode?: ReadonlySet<string>,
  depth = 0,
): Decoded {
  if (data === '0x') return { kind: 'empty' }
  if (data.length < 10) return { kind: 'raw', level: 5 }
  const selector = slice(data, 0, 4).toLowerCase() as Hex
  if (selectorsInBytecode && !selectorsInBytecode.has(selector))
    return { kind: 'raw', level: 5, selector }
  for (const { source, abi } of sources) {
    const fn = (abi as readonly AbiFunction[]).find(
      (item) => item.type === 'function' && toFunctionSelector(item) === selector,
    )
    if (!fn) continue
    try {
      const args = namedArgs(fn, decodeFunctionData({ abi: [fn], data }).args)
      const calls = args.find((a) => a.type === 'bytes[]')
      const inner =
        SELF_MULTICALLS.has(fn.name) && calls && depth < MAX_MULTICALL_DEPTH
          ? (calls.value as readonly Hex[]).map((d) => ({
              data: d,
              decoded: decodeCalldata(d, sources, selectorsInBytecode, depth + 1),
            }))
          : undefined
      return {
        kind: 'abi',
        level: 3,
        source,
        functionName: fn.name,
        signature: `${fn.name}(${fn.inputs.map((i) => i.type).join(',')})`,
        args,
        ...(inner ? { inner } : {}),
      }
    } catch {
      // The selector matched but the arguments don't decode: treat as undecodable.
      return { kind: 'raw', level: 5, selector }
    }
  }
  return { kind: 'raw', level: 5, selector }
}

/**
 * Level 4 (SPEC §7.1): a signature-database entry that decodes the calldata. Display only:
 * anyone can register a signature with a colliding selector, so safety rules never use it.
 */
export interface Guess {
  readonly signature: string
  readonly args: readonly DecodedArg[]
  /** Other registered signatures that also decode this calldata. */
  readonly alternatives: readonly string[]
}

export function guessCall(data: Hex, signatures: readonly string[]): Guess | undefined {
  if (data.length < 10) return undefined
  const selector = slice(data, 0, 4).toLowerCase()
  const decodable = signatures.flatMap((signature) => {
    try {
      const fn = parseAbiItem(`function ${signature}`) as AbiFunction
      if (toFunctionSelector(fn) !== selector) return []
      const { args } = decodeFunctionData({ abi: [fn], data })
      return [{ signature, args: namedArgs(fn, args) }]
    } catch {
      return []
    }
  })
  const [first, ...rest] = decodable
  if (!first) return undefined
  return {
    signature: first.signature,
    args: first.args,
    alternatives: rest.map((r) => r.signature),
  }
}

/**
 * A multiSend(bytes) batch with each call decoded by `decodeCall`, or undefined if the calldata
 * isn't a well-formed batch. Only for targets verified as MultiSend by code hash (SPEC §7.4).
 */
export function decodeBatch(
  data: Hex,
  source: string,
  decodeCall: (call: BatchCall) => Decoded,
): Decoded | undefined {
  const calls = decodeMultiSend(data)
  if (!calls) return undefined
  return {
    kind: 'batch',
    level: 3,
    source,
    calls: calls.map((call) => ({ call, decoded: decodeCall(call) })),
  }
}

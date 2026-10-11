// Parsing typed function inputs from text (SPEC §3.3 contract call: "fill typed inputs").
// Arrays and tuples are entered as JSON; scalars as plain text.
import { getAddress, isAddress, isHex, size } from 'viem'

interface Param {
  readonly name?: string | undefined
  readonly type: string
  readonly components?: readonly Param[] | undefined
}

export class ArgError extends Error {}

const arrayOf = /^(.*)\[(\d*)\]$/

function convert(param: Param, value: unknown, path: string): unknown {
  const m = arrayOf.exec(param.type)
  if (m) {
    if (!Array.isArray(value)) throw new ArgError(`${path}: expected a JSON array`)
    const length = m[2] ? Number(m[2]) : undefined
    if (length !== undefined && value.length !== length) {
      throw new ArgError(`${path}: expected ${length} items, got ${value.length}`)
    }
    const inner = { ...param, type: m[1] as string }
    return value.map((v, i) => convert(inner, v, `${path}[${i}]`))
  }
  if (param.type === 'tuple') {
    const comps = param.components ?? []
    if (Array.isArray(value))
      return comps.map((c, i) => convert(c, value[i], `${path}.${c.name ?? i}`))
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      return Object.fromEntries(
        comps.map((c, i) => [
          c.name ?? i,
          convert(c, obj[c.name ?? String(i)], `${path}.${c.name ?? i}`),
        ]),
      )
    }
    throw new ArgError(`${path}: expected a JSON object or array`)
  }
  return scalar(param.type, value, path)
}

function scalar(type: string, value: unknown, path: string): unknown {
  const text = typeof value === 'string' ? value.trim() : value
  if (type === 'address') {
    if (typeof text !== 'string' || !isAddress(text, { strict: true }))
      throw new ArgError(`${path}: not a valid address`)
    return getAddress(text)
  }
  if (type === 'bool') {
    if (text === true || text === 'true') return true
    if (text === false || text === 'false') return false
    throw new ArgError(`${path}: enter true or false`)
  }
  const int = /^(u?)int(\d*)$/.exec(type)
  if (int) {
    // BigInt would read blank text or a JSON boolean as a number, and a JSON number past 2^53
    // has already lost precision
    if (typeof text === 'number' && Number.isInteger(text) && !Number.isSafeInteger(text))
      throw new ArgError(`${path}: put numbers this large in quotes`)
    if (typeof text !== 'number' && (typeof text !== 'string' || text === ''))
      throw new ArgError(`${path}: not a whole number`)
    const bits = BigInt(int[2] || 256)
    let n: bigint
    try {
      n = BigInt(text)
    } catch {
      throw new ArgError(`${path}: not a whole number`)
    }
    const [min, max] =
      int[1] === 'u' ? [0n, 2n ** bits - 1n] : [-(2n ** (bits - 1n)), 2n ** (bits - 1n) - 1n]
    if (n < min || n > max) throw new ArgError(`${path}: out of range for ${type}`)
    return n
  }
  const bytes = /^bytes(\d*)$/.exec(type)
  if (bytes) {
    if (typeof text !== 'string' || !isHex(text) || text.length % 2 !== 0)
      throw new ArgError(`${path}: enter 0x-prefixed hex bytes`)
    if (bytes[1] && size(text) !== Number(bytes[1]))
      throw new ArgError(`${path}: must be exactly ${bytes[1]} bytes`)
    return text
  }
  if (type === 'string') {
    if (typeof value !== 'string') throw new ArgError(`${path}: expected text`)
    return value
  }
  throw new ArgError(`${path}: unsupported type ${type}`)
}

/** Convert one form field's text into the value viem's encoder expects. */
export function parseArg(param: Param, text: string, path = param.name || 'value'): unknown {
  const compound = arrayOf.test(param.type) || param.type === 'tuple'
  if (!compound) return scalar(param.type, text, path)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ArgError(`${path}: enter valid JSON`)
  }
  return convert(param, json, path)
}

/** Placeholder text for an input of this type. */
export function argPlaceholder(param: Param): string {
  if (arrayOf.test(param.type)) return '["…", "…"] (JSON)'
  if (param.type === 'tuple') return '{ … } (JSON)'
  if (param.type === 'address') return '0x…'
  if (param.type === 'bool') return 'true or false'
  if (param.type.startsWith('bytes')) return '0x…'
  if (/int/.test(param.type)) return 'whole number (base units)'
  return ''
}

import { getAddress, isAddress } from 'viem'

/** `0x1234…abcd`, checksummed. */
export function shortAddress(address: string): string {
  const a = isAddress(address, { strict: false }) ? getAddress(address) : address
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

/** Same address in any case (viem's isAddressEqual throws on anything that isn't one). */
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** "1 owner", "2 owners" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "a", "a and b", "a, b and c" */
export const list = (parts: readonly string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`

/** JSON with bigints as decimal strings, for query keys and comparing values by content. */
export const jsonWithBigints = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

/** A decoded argument as text: integers in full, arrays and structs spelled out. */
export const argText = (v: unknown): string =>
  typeof v === 'bigint'
    ? v.toString()
    : Array.isArray(v)
      ? `[${v.map(argText).join(', ')}]`
      : typeof v === 'object' && v !== null
        ? jsonWithBigints(v)
        : String(v)

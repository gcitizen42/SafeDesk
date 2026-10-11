import { Schema } from 'effect'
import { isAddress } from 'viem'

/** A 0x address, any case (display code checksums it). */
export const Address = Schema.TemplateLiteral('0x', Schema.String).pipe(
  Schema.filter((s) => isAddress(s, { strict: false }) || 'Expected a 20-byte 0x address'),
)

export const Hex = Schema.TemplateLiteral('0x', Schema.String).pipe(
  Schema.filter((s) => /^0x([0-9a-fA-F]{2})*$/.test(s) || 'Expected 0x-prefixed hex bytes'),
)

export const ChainId = Schema.Int.pipe(Schema.between(1, Number.MAX_SAFE_INTEGER))

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** An RPC endpoint: https, or http only for a node on this machine. */
export const RpcUrl = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      const u = new URL(s)
      if (u.protocol === 'https:') return true
      if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return true
      return 'Use an https:// URL (http:// is allowed only for localhost)'
    } catch {
      return 'Not a valid URL'
    }
  }),
)

/** An https URL the app only links to and never fetches (for example a block explorer). */
export const LinkUrl = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      return new URL(s).protocol === 'https:' || 'Use an https:// URL'
    } catch {
      return 'Not a valid URL'
    }
  }),
)

/** A bare origin such as `https://tokens.uniswap.org`. */
export const Origin = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      const u = new URL(s)
      return (u.protocol === 'https:' && u.origin === s) || 'Expected an https origin'
    } catch {
      return 'Not a valid origin'
    }
  }),
)

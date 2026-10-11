// The selectors behind the "function is not in the bytecode" check and the decoders' filter
// (SPEC §7.3), from whatsabi's autoload result. Pure, so it's tested on bytecode fixtures.
import { type AutoloadResult, selectorsFromBytecode } from '@shazow/whatsabi'
import type { Hex } from 'viem'

/**
 * The 4-byte selectors of the contract whatsabi resolved to, sorted. `code` is that contract's
 * code: the implementation's when a proxy was followed, otherwise the target's own.
 *
 * whatsabi returns no ABI at all when it finds a proxy pattern it can't follow. The Safe
 * ProxyFactory is one: it embeds GnosisSafeProxy's creation code and has nothing in slot 0, so
 * whatsabi stops at the factory with zero selectors and every call to it would be filtered out.
 * When whatsabi finds none, the selectors come from `code`'s own jump table.
 */
export function selectorsOf(loaded: Pick<AutoloadResult, 'abi'>, code: Hex | undefined): Hex[] {
  const fromAbi = loaded.abi.flatMap((item) =>
    item.type === 'function' && 'selector' in item ? [item.selector as Hex] : [],
  )
  const selectors =
    fromAbi.length === 0 && code && code !== '0x' ? (selectorsFromBytecode(code) as Hex[]) : fromAbi
  return [...new Set(selectors)].sort()
}

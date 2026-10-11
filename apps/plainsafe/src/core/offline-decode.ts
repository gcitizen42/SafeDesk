// Decoding with bundled knowledge only, no chain reads (SPEC §7.1): this chain's Universal Router
// (§3.13), the Safe's own ABI for calls on itself, then the bundled standard ABIs. Used for
// one-line summaries (queue, history, import), the Verify page, and the calls in a batch.
import type { Address } from 'viem'
import { type Decoded, decodeCalldata } from './decode'
import { knownAbis, safeManagementAbi } from './known-abis'
import type { SafeTx } from './safe-tx'
import { decodeRouterFor } from './uniswap'

/** How the review screen names a bundled ABI: "ERC-20 standard ABI". */
export const standardLabel = (abiName: string) => `${abiName} standard ABI`

export function decodeOffline(
  chainId: number,
  safe: Address,
  tx: Pick<SafeTx, 'to' | 'data' | 'operation'>,
  options: {
    /** How a bundled ABI is named; its plain name ("ERC-20") by default. */
    label?: (abiName: string) => string
    /** The target's selectors, when its bytecode is known: decodings stay within them (§7.3). */
    selectors?: ReadonlySet<string> | undefined
  } = {},
): Decoded {
  const { label = (name) => name, selectors } = options
  const router = tx.operation === 0 ? decodeRouterFor(chainId, tx.to, tx.data) : undefined
  if (router) return router
  return tx.to.toLowerCase() === safe.toLowerCase()
    ? decodeCalldata(tx.data, [{ source: 'Safe', abi: safeManagementAbi }])
    : decodeCalldata(
        tx.data,
        knownAbis.map((k) => ({ source: label(k.name), abi: k.abi })),
        selectors,
      )
}

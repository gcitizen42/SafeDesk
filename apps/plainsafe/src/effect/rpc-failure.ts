import { causes, shortMessage } from '@/core/rpc-errors'
import { NetguardBlockedError } from '@/netguard/guard'
import { BlockedByNetguard, RpcError } from './errors'

/** Map a thrown RPC failure to a tagged error. A netguard block is never retried. */
export const rpcFailure =
  (endpoint: string) =>
  (e: unknown): RpcError | BlockedByNetguard => {
    const blocked = causes(e).find(
      (c): c is NetguardBlockedError => c instanceof NetguardBlockedError,
    )
    if (blocked) return new BlockedByNetguard({ host: blocked.host })
    return new RpcError({ endpoint, message: shortMessage(e) })
  }

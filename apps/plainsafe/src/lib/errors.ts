// Plain-language text for the tagged errors programs throw (SPEC §9.2).

/** How errors name the wallet's provider, in place of a URL. */
export const WALLET_ENDPOINT = "your wallet's RPC"

export function describeError(error: unknown): string {
  const e = error as {
    _tag?: string
    host?: string
    endpoint?: string
    message?: string
    expected?: number
    actual?: number
    chainId?: number
  }
  switch (e?._tag) {
    case 'BlockedByNetguard':
      return `Blocked by netguard: ${e.host} is not in the allowlist.`
    case 'RpcError':
      return `Couldn't read from ${e.endpoint}: ${e.message}`
    case 'WrongChain':
      return `${e.endpoint === WALLET_ENDPOINT ? 'Your wallet' : e.endpoint} is on chain ${e.actual}, not chain ${e.expected}.`
    case 'NotAContract':
      return `There is no contract at this address on chain ${e.chainId}.`
    case 'ExecutionWouldFail':
      return `This transaction would fail: ${e.message}`
    case 'InvalidRecord':
      return `Stored data is invalid and was not used: ${e.message}`
    case 'StorageError':
      return "Couldn't access this browser's storage."
    default:
      return e?.message ?? String(error)
  }
}

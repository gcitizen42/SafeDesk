// Every query key comes from here (SPEC §9.3). Block numbers are strings: query keys are hashed
// with JSON.stringify, which cannot serialize bigint.
import type { Address, Hex } from 'viem'

const block = (n?: bigint) => (n === undefined ? [] : [n.toString()])

export const keys = {
  /** User data from IndexedDB (not chain state). */
  settings: () => ['settings'] as const,
  mySafes: () => ['user', 'safes'] as const,
  recent: () => ['user', 'recent'] as const,
  addressBook: () => ['user', 'addressbook'] as const,
  packages: (chainId: number, safe: Address) =>
    ['user', 'packages', chainId, safe.toLowerCase()] as const,
  package: (chainId: number, safe: Address, safeTxHash: Hex) =>
    ['user', 'packages', chainId, safe.toLowerCase(), safeTxHash.toLowerCase()] as const,
  savedAbis: () => ['user', 'abi'] as const,
  savedAbi: (chainId: number, codeHash: Hex) =>
    ['user', 'abi', chainId, codeHash.toLowerCase()] as const,
  rpcCaps: (rpcUrl: string) => ['rpc-caps', rpcUrl] as const,
  safe: (chainId: number, address: Address, blockNumber?: bigint) =>
    ['safe', chainId, address.toLowerCase(), ...block(blockNumber)] as const,
  allBalances: () => ['balances'] as const,
  balances: (chainId: number, safe: Address, tokenSetHash: string) =>
    ['balances', chainId, safe.toLowerCase(), tokenSetHash] as const,
  whatsabi: (chainId: number, address: Address) =>
    ['whatsabi', chainId, address.toLowerCase()] as const,
  /** SPEC §7.3: Sourcify ABIs live only in memory, keyed by implementation code hash. */
  sourcify: (chainId: number, implementationCodeHash: Hex) =>
    ['sourcify', chainId, implementationCodeHash.toLowerCase()] as const,
  signatures: (selector: Hex) => ['signatures', selector.toLowerCase()] as const,
  render: (chainId: number, safeTxHash: Hex) => ['render', chainId, safeTxHash] as const,
  approvals: (chainId: number, safe: Address, safeTxHash: Hex, blockNumber: bigint) =>
    ['approvals', chainId, safe.toLowerCase(), safeTxHash, blockNumber.toString()] as const,
  simulation: (chainId: number, safeTxHash: Hex, blockNumber: bigint) =>
    ['simulation', chainId, safeTxHash, blockNumber.toString()] as const,
  /** The queue's consecutive nonces, simulated together (P1). */
  queueSimulation: (
    chainId: number,
    safe: Address,
    blockNumber: bigint,
    safeTxHashes: readonly Hex[],
  ) =>
    [
      'queue-simulation',
      chainId,
      safe.toLowerCase(),
      blockNumber.toString(),
      ...safeTxHashes,
    ] as const,
  ethFiat: (currency: string) => ['eth-fiat', 1, currency] as const,
  tokenLists: () => ['user', 'tokenlists'] as const,
  userDescriptors: () => ['user', 'descriptors'] as const,
  myTokens: () => ['user', 'mytokens'] as const,
  tokenMeta: (chainId: number, token: Address) =>
    ['token-meta', chainId, token.toLowerCase()] as const,
  ens: (chainId: number, address: Address) => ['ens', chainId, address.toLowerCase()] as const,
  /** A typed ENS name resolved for an address field (SPEC §8.5). */
  ensResolve: (chainId: number, name: string) =>
    ['ens-resolve', chainId, name.toLowerCase()] as const,
  /** SPEC §11: the stored onchain history index (a rebuildable cache in IndexedDB). */
  allHistory: () => ['history'] as const,
  historyCheckpoints: () => ['history', 'all'] as const,
  history: (chainId: number, safe: Address, part?: 'checkpoint' | 'events') =>
    ['history', chainId, safe.toLowerCase(), ...(part ? [part] : [])] as const,
  /** The transaction that ran an execution (SPEC §11): its calldata and sender. */
  historyTx: (chainId: number, txHash: Hex) =>
    ['history-tx', chainId, txHash.toLowerCase()] as const,
  /** Signers recovered from an execution's signatures: pure, so not tied to a chain. */
  executedSigners: (safeTxHash: Hex, signatures: Hex) =>
    ['executed-signers', safeTxHash.toLowerCase(), signatures.toLowerCase()] as const,
  /** SPEC §3.14: the pre-flight checks for creating the Safe at `address`, as sent from `from`. */
  safeCreation: (chainId: number, address: Address, from?: Address) =>
    ['safe-creation', chainId, address.toLowerCase(), from?.toLowerCase() ?? ''] as const,
  /** SPEC §3.13: are the Uniswap contracts deployed on this chain? */
  swapContracts: (chainId: number) => ['swap-contracts', chainId] as const,
  swapQuote: (chainId: number, sell: Address, buy: Address, amountIn: bigint) =>
    ['swap-quote', chainId, sell.toLowerCase(), buy.toLowerCase(), amountIn.toString()] as const,
  /** A fresh quote for one route, keyed by the route's text. */
  requote: (chainId: number, route: string, amountIn: bigint) =>
    ['requote', chainId, route, amountIn.toString()] as const,
  /** The swap transaction built from a plan, keyed by the plan's JSON. */
  swapBuild: (chainId: number, safe: Address, plan: string) =>
    ['swap-build', chainId, safe.toLowerCase(), plan] as const,
  /** Pure: a package's share link payload, per set of signers. */
  sharePayload: (safeTxHash: Hex, signers: string) =>
    ['share-payload', safeTxHash, signers] as const,
  /** Pure: a shared link's payload, decoded and verified offline (SPEC §3.7 step 1). */
  importPayload: (payload: string) => ['import', payload] as const,
  /** The bundled clear-signing registry's pinned commit (SPEC §7.2). */
  bundledRegistry: () => ['clear-signing-bundle'] as const,
}

/** SPEC §9.3: changing a chain's RPC or a capability invalidates every key for that chain. */
export const isChainKey = (chainId: number) => (queryKey: readonly unknown[]) =>
  queryKey[1] === chainId

/** Every key read from some chain (a capability applies to all chains). */
export const isAnyChainKey = (queryKey: readonly unknown[]) => typeof queryKey[1] === 'number'

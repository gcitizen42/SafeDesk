// Which ENS registry and coin type to use for a Safe's chain (SPEC §8.5).
import { toCoinType } from 'viem'

/** Sepolia Safes use Sepolia ENS; every other chain uses Mainnet ENS, since ENS lives on L1. */
export const ensChainFor = (chainId: number) => (chainId === 11155111 ? 11155111 : 1)

/**
 * ENSIP-9/11/19 coin type for addresses on `chainId`. On the ENS registry's own chain (Mainnet,
 * or Sepolia for Sepolia ENS) that's the ETH coin type, 60.
 */
export const coinTypeFor = (chainId: number) =>
  chainId === ensChainFor(chainId) ? 60n : toCoinType(chainId)

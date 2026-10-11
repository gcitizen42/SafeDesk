// Display-only prices from the 1inch Spot Price Aggregator (SPEC §10.1). Never used for safety.

import type { Address } from 'viem'

const SPOT_AGGREGATOR: Address = '0x0AdDd25a91563696D8567Df78D5A01C9a991F9B8'
const SPOT_AGGREGATOR_ZKSYNC: Address = '0xc9bB6e4FF7dEEa48e045CEd9C0ce016c7CFbD500'
export const aggregatorFor = (chainId: number): Address =>
  chainId === 324 ? SPOT_AGGREGATOR_ZKSYNC : SPOT_AGGREGATOR

/** Mainnet stablecoins for ETH → fiat. */
export const FIAT_STABLES: Record<'USD' | 'EUR', { address: Address; decimals: number }> = {
  USD: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  EUR: { address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', decimals: 6 },
}

/**
 * getRateToEth is scaled by 1e18 × 10^(18 − decimals), so value in wei = balance × rate / 1e18.
 */
export const valueInWei = (balance: bigint, rate: bigint) => (balance * rate) / 10n ** 18n

/** Fiat per 1 ETH from the stablecoin's rate: 1 / (rate / 10^(36 − decimals)). */
export function fiatPerEth(stableRate: bigint, stableDecimals: number): number | undefined {
  if (stableRate === 0n) return undefined
  return 10 ** (36 - stableDecimals) / Number(stableRate)
}

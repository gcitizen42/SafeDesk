// The `#/safe/:chainId/:address/…` routes' parameters (SPEC §9.4).
import { type Address, getAddress, isAddress } from 'viem'
import { useParams } from 'wouter'
import { useChain } from '@/queries/settings'

/** Route params → a configured chain and a valid address, or undefined. */
export function useSafeParams(): { chainId: number; address: Address } | undefined {
  const params = useParams<{ chainId: string; address: string }>()
  const chainId = Number(params.chainId)
  const chain = useChain(chainId)
  if (!chain) return undefined
  if (!isAddress(params.address, { strict: false })) return undefined
  return { chainId, address: getAddress(params.address) }
}

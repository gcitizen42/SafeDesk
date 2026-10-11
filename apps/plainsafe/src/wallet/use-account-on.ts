// Before a wallet action: a connected account, on the action's chain. Wallets reject typed data
// and transactions for another chain, so the chain is switched (or added) first (SPEC §3.5, §8.3).
import { useConnection, useSwitchChain } from 'wagmi'
import { requireWalletActions } from './local-policy'

export function useAccountOn() {
  const connection = useConnection()
  const switchChain = useSwitchChain()
  return async (chainId: number, notConnected = 'Connect your wallet first.') => {
    requireWalletActions()
    if (connection.status !== 'connected') throw new Error(notConnected)
    if (connection.chainId !== chainId) await switchChain.mutateAsync({ chainId })
    return connection.address
  }
}

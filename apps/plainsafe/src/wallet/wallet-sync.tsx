// Gives the Rpc service the connected wallet's provider, for chains set to "use my wallet's RPC".
import { useEffect } from 'react'
import type { EIP1193Provider } from 'viem'
import { useConnection } from 'wagmi'
import { setWallet } from '@/effect/rpc'

export function WalletSync() {
  const { status, chainId, connector } = useConnection()
  useEffect(() => {
    let cancelled = false
    if (status === 'connected' && connector && chainId !== undefined) {
      void connector.getProvider().then((provider) => {
        if (!cancelled) setWallet({ provider: provider as EIP1193Provider, chainId })
      })
    } else {
      setWallet(undefined)
    }
    return () => {
      cancelled = true
    }
  }, [status, chainId, connector])
  return null
}

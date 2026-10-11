// The RPC Test on setup, Settings → RPCs and Add a chain (SPEC §3.1). It runs only when Test is
// pressed (`refetch`), never on its own.
import { useQuery } from '@tanstack/react-query'
import type { EIP1193Provider } from 'viem'
import { useConnection } from 'wagmi'
import { run } from '@/effect/run'
import { grantOrigin } from '@/features/settings/policy-sync'
import { testRpc } from '@/features/setup/rpc-test'
import { originOf } from '@/netguard'
import { keys } from './keys'

export function useUrlRpcTest(url: string) {
  return useQuery({
    queryKey: keys.rpcCaps(url),
    queryFn: () => {
      // Pressing Test is consent for this one origin, for this session (SPEC §3.1).
      const origin = originOf(url)
      if (origin) grantOrigin(origin)
      return run(testRpc({ kind: 'url', url }))
    },
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

export function useWalletRpcTest(chainId: number) {
  const connection = useConnection()
  return useQuery({
    queryKey: keys.rpcCaps(`wallet:${chainId}`),
    queryFn: async () => {
      if (connection.status !== 'connected')
        throw new Error('Connect your wallet first (top right).')
      const provider = (await connection.connector.getProvider()) as EIP1193Provider
      return run(testRpc({ kind: 'wallet', provider }))
    },
    enabled: false,
    staleTime: 0,
    retry: false,
  })
}

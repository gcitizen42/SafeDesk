import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import type { VerifiedPackage } from '@/core/package'
import { run } from '@/effect/run'
import { deletePackage, getPackage, listPackages, savePackage } from '@/features/queue/store'
import { keys } from './keys'

export function usePackage(chainId: number, safe: Address, safeTxHash: Hex) {
  return useQuery({
    queryKey: keys.package(chainId, safe, safeTxHash),
    queryFn: () => run(getPackage(chainId, safe, safeTxHash)),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function usePackages(chainId: number, safe: Address) {
  return useQuery({
    queryKey: keys.packages(chainId, safe),
    queryFn: () => run(listPackages(chainId, safe)),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSavePackage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: VerifiedPackage) => run(savePackage(v)),
    onSuccess: (_, v) =>
      queryClient.invalidateQueries({ queryKey: keys.packages(v.pkg.chainId, v.pkg.safe) }),
  })
}

export function useDeletePackage(chainId: number, safe: Address) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (safeTxHash: Hex) => run(deletePackage(chainId, safe, safeTxHash)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.packages(chainId, safe) }),
  })
}

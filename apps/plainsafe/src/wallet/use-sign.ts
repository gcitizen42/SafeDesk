// Signing with eth_signTypedData_v4 through wagmi (SPEC §3.5), on the Safe's chain.
import { useMutation } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useSignMessage, useSignTypedData } from 'wagmi'
import { type SafeTx, safeTxHashes, safeTxTypedData } from '@/core/safe-tx'
import {
  normalizePersonalSignature,
  normalizeV,
  recoverSafeSignature,
  type SigningMethod,
} from '@/core/signatures'
import type { PackageSignature } from '@/schemas/package'
import { useAccountOn } from './use-account-on'

export function useSignSafeTx() {
  const accountOn = useAccountOn()
  const signTypedData = useSignTypedData()
  const signMessage = useSignMessage()
  return useMutation({
    mutationFn: async ({
      chainId,
      safe,
      tx,
      method = 'eip712',
    }: {
      chainId: number
      safe: Address
      tx: SafeTx
      method?: SigningMethod
    }): Promise<PackageSignature> => {
      const account = await accountOn(chainId)
      const typed = safeTxTypedData(chainId, safe, tx)
      const hash = safeTxHashes(chainId, safe, tx).safeTx
      if (!['eip712', 'eth_sign'].includes(method)) throw new Error('Unsupported signing method')
      const raw =
        method === 'eip712'
          ? await signTypedData.mutateAsync({ ...typed, account })
          : await signMessage.mutateAsync({ account, message: { raw: hash } })
      const data = method === 'eip712' ? normalizeV(raw) : normalizePersonalSignature(raw)
      // Check the signature by recovering it before it's stored (SPEC §3.5).
      const signer = await recoverSafeSignature(hash, data, method)
      if (signer?.toLowerCase() !== account.toLowerCase()) {
        throw new Error(
          `The wallet returned a signature that doesn't recover to ${account}. It was not stored.`,
        )
      }
      return { signer: account, kind: method, data }
    },
  })
}

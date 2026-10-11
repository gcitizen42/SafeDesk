// Signing with eth_signTypedData_v4 through wagmi (SPEC §3.5), on the Safe's chain.
import { useMutation } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useSignTypedData } from 'wagmi'
import { type SafeTx, safeTxHashes, safeTxTypedData } from '@/core/safe-tx'
import { normalizeV, recoverSigner } from '@/core/signatures'
import type { PackageSignature } from '@/schemas/package'
import { useAccountOn } from './use-account-on'

export function useSignSafeTx() {
  const accountOn = useAccountOn()
  const signTypedData = useSignTypedData()
  return useMutation({
    mutationFn: async ({
      chainId,
      safe,
      tx,
    }: {
      chainId: number
      safe: Address
      tx: SafeTx
    }): Promise<PackageSignature> => {
      const account = await accountOn(chainId)
      const typed = safeTxTypedData(chainId, safe, tx)
      const raw = await signTypedData.mutateAsync({ ...typed, account })
      const data = normalizeV(raw)
      // Check the signature by recovering it before it's stored (SPEC §3.5).
      const signer = await recoverSigner(safeTxHashes(chainId, safe, tx).safeTx, data)
      if (signer?.toLowerCase() !== account.toLowerCase()) {
        throw new Error(
          `The wallet returned a signature that doesn't recover to ${account}. It was not stored.`,
        )
      }
      return { signer: account, kind: 'eip712', data }
    },
  })
}

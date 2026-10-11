// Sign (SPEC §3.5) and save to the queue in one mutation, so a failure at any step shows by the
// button. The package is verified like an import before it's stored.
import { useMutation } from '@tanstack/react-query'
import { Either } from 'effect'
import type { Address } from 'viem'
import { mergeSignatures, type VerifiedPackage, verifyPackage } from '@/core/package'
import type { SafeTx } from '@/core/safe-tx'
import { useSavePackage } from '@/queries/packages'
import type { SafeTxPackage } from '@/schemas/package'
import { useSignSafeTx } from '@/wallet/use-sign'

/**
 * `onSaved` runs once the package is stored, even if the screen has closed meanwhile (the wallet
 * prompt can outlast it): a callback passed to `mutate` would only run while it's still open.
 */
export function useSignAndSave(
  chainId: number,
  safe: Address,
  tx: SafeTx,
  onSaved?: (v: VerifiedPackage) => void,
) {
  const sign = useSignSafeTx()
  const save = useSavePackage()
  return useMutation({
    mutationFn: async ({ pkg, withSignature }: { pkg: SafeTxPackage; withSignature: boolean }) => {
      const added = withSignature ? [await sign.mutateAsync({ chainId, safe, tx })] : []
      const v = await verifyPackage({ ...pkg, signatures: mergeSignatures(pkg.signatures, added) })
      if (Either.isLeft(v)) throw new Error(`Couldn't save the transaction: ${v.left._tag}`)
      await save.mutateAsync(v.right)
      return v.right
    },
    onSuccess: onSaved,
  })
}

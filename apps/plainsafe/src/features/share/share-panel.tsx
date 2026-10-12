// Sharing a package (SPEC §3.6): a link whose payload lives after `#`, a plainsafe:1: code, or
// a JSON file. Nothing is uploaded anywhere.
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { exportBuilderJson, signingData } from '@/core/builder-json'
import { encodePayload, packageFileName, shareCode, shareLink } from '@/core/package'
import { downloadJson } from '@/lib/download'
import { keys } from '@/queries/keys'
import type { SafeTxPackage } from '@/schemas/package'

const LINK_LIMIT = 4 * 1024

function CopyAction({
  label,
  value,
  testId,
}: {
  label: string
  value: string | undefined
  testId: string
}) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="outline"
      disabled={!value}
      data-testid={testId}
      data-value={value}
      onClick={() => {
        if (!value) return
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <Check /> : <Copy />} {done ? 'Copied' : label}
    </Button>
  )
}

export function SharePanel({ pkg }: { pkg: SafeTxPackage }) {
  const [operationId, setOperationId] = useState(
    `tx-${pkg.chainId}-${pkg.tx.nonce}-${pkg.hashes.safeTx.slice(-6)}`,
  )
  const validId = /^[a-z0-9][a-z0-9-]{0,63}$/.test(operationId)
  const proposalSupported = [1, 10, 137, 42161, 8453, 60808].includes(pkg.chainId)
  const payload = useQuery({
    queryKey: keys.sharePayload(pkg.hashes.safeTx, pkg.signatures.map((s) => s.signer).join(',')),
    queryFn: () => encodePayload(pkg),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const link = payload.data ? shareLink(window.location.href, payload.data) : undefined
  const code = payload.data ? shareCode(payload.data) : undefined
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" data-testid="share-panel">
      <h2 className="font-medium">Share with co-signers</h2>
      <p className="text-sm text-muted-foreground">
        The link carries the transaction and {pkg.signatures.length} signature
        {pkg.signatures.length === 1 ? '' : 's'} after the “#”, which browsers never send to a
        server. Co-signers can open it in SafeDesk, or paste the code.
      </p>
      <div className="flex flex-wrap gap-2">
        <CopyAction label="Copy link" value={link} testId="copy-link" />
        <CopyAction label="Copy code" value={code} testId="copy-code" />
        <Button
          variant="outline"
          onClick={() => downloadJson(packageFileName(pkg), pkg)}
          data-testid="download-json"
        >
          <Download /> Download JSON
        </Button>
      </div>
      <div className="flex flex-col gap-2 border-t pt-3">
        <label className="text-sm">
          Proposal operation name
          <input
            aria-label="Proposal operation name"
            className="mt-1 h-9 w-full rounded-lg border px-2"
            value={operationId}
            onChange={(e) => setOperationId(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!validId}
            onClick={() => downloadJson(`builder-${operationId}.json`, exportBuilderJson(pkg))}
          >
            <Download />
            Safe Builder JSON
          </Button>
          <Button
            variant="outline"
            disabled={!validId || !proposalSupported}
            onClick={() => downloadJson(`${operationId}-signing-data.json`, signingData(pkg))}
          >
            <Download />
            Proposal signing data
          </Button>
          <Button
            variant="outline"
            disabled={!validId || !proposalSupported || !pkg.signatures.length}
            onClick={() =>
              downloadJson(`${operationId}-signatures.json`, {
                version: 1,
                operations: [
                  {
                    id: operationId,
                    signing: signingData(pkg),
                    signatures: pkg.signatures.map((s) => ({
                      sender: s.signer,
                      signature: s.data,
                    })),
                  },
                ],
              })
            }
          >
            <Download />
            Proposal signatures
          </Button>
        </div>
      </div>
      {pkg.tx.operation === 1 && (
        <p className="text-sm text-amber-700">
          DELEGATECALL (1) must be preserved when importing elsewhere. Verify the operation and full
          SafeTx hash before signing.
        </p>
      )}
      {link && link.length > LINK_LIMIT && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This link is {Math.round(link.length / 1024)} KB. Chat apps often cut long links; send the
          JSON file instead.
        </p>
      )}
    </section>
  )
}

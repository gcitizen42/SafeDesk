// Sharing a package (SPEC §3.6): a link whose payload lives after `#`, a plainsafe:1: code, or
// a JSON file. Nothing is uploaded anywhere.
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
        server. Co-signers can open it in any copy of Plain Safe, or paste the code.
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
      {link && link.length > LINK_LIMIT && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          This link is {Math.round(link.length / 1024)} KB. Chat apps often cut long links; send the
          JSON file instead.
        </p>
      )}
    </section>
  )
}

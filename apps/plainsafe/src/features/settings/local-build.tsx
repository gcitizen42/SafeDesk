import { useQuery } from '@tanstack/react-query'
import { Fingerprint } from 'lucide-react'
import { Link } from 'wouter'
import { CopyButton } from '@/components/address'

interface BuildFingerprint {
  algorithm: 'SHA-256'
  contentHash: string
  sourceHash: string | null
  commit: string | null
  sourceDirty: boolean | null
  sourceChecked: boolean
  fileCount: number
}
function useLocalBuild() {
  return useQuery({
    queryKey: ['local-build-fingerprint'],
    staleTime: Infinity,
    queryFn: async (): Promise<BuildFingerprint | null> => {
      const response = await fetch('/.well-known/safedesk-manager', { credentials: 'omit' })
      if (!response.ok) return null
      const document = (await response.json()) as { build?: BuildFingerprint }
      const value = document.build
      return value?.algorithm === 'SHA-256' && /^[a-f0-9]{64}$/.test(value.contentHash)
        ? value
        : null
    },
  })
}
export function LocalBuildBadge() {
  const build = useLocalBuild()
  if (!build.data) return null
  return (
    <Link
      href="/settings/about"
      className="inline-flex items-center gap-1 text-xs text-emerald-700"
      title="Built files match the local SHA-256 manifest. View the fingerprint and limits."
    >
      <Fingerprint className="size-3.5" aria-hidden="true" />
      Build fingerprint
    </Link>
  )
}
export function LocalBuildDetails() {
  const build = useLocalBuild()
  if (!build.data)
    return (
      <p className="text-sm text-muted-foreground">
        No local build fingerprint is available from this server.
      </p>
    )
  const value = build.data
  const rows = [
    ['App files SHA-256', value.contentHash],
    ['Tracked source SHA-256', value.sourceHash ?? 'Not available (source archive without Git)'],
    ['SafeDesk build commit', value.commit ?? 'Not available'],
  ]
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="font-medium">Local build verification</h3>
      <p className="text-sm text-muted-foreground">
        {value.fileCount} built files match the local SHA-256 manifest.{' '}
        {value.sourceChecked
          ? 'The tracked source matches the build fingerprint.'
          : 'Source comparison is unavailable.'}{' '}
        {value.sourceDirty ? 'Built with local source changes.' : ''}
      </p>
      <dl className="flex min-w-0 flex-col gap-2">
        {rows.map(([label, hash]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 items-start gap-1">
              <code className="min-w-0 text-xs break-all">{hash}</code>
              <CopyButton value={hash ?? ''} label={`Copy ${label}`} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        A local manifest detects changed files, not a maliciously replaced application and manifest.
        Compare the source and commit with the{' '}
        <a
          className="underline"
          href="https://github.com/gcitizen42/SafeDesk"
          target="_blank"
          rel="noreferrer"
        >
          SafeDesk repository
        </a>
        . This is not an audit or proof that a browser, device or RPC is trustworthy.
      </p>
    </section>
  )
}

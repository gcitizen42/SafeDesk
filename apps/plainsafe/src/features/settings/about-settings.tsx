// Settings → About (SPEC §3.12): version, commit, the pinned data sources, and dependencies.
import { deployments } from '@/core/deployments'
import { useBundledRegistry } from '@/queries/clear-signing'

const build = __PLAINSAFE_BUILD__

export function AboutSettings() {
  const registry = useBundledRegistry()
  const rows: [string, string][] = [
    ['Version', build.version],
    ['Commit', `${build.commit}${build.dirty ? ' (with local changes)' : ''}`],
    [
      'safe-deployments',
      `${deployments.source.tag} (${deployments.source.commit}), ${deployments.source.repo}`,
    ],
    [
      'Clear-signing registry',
      registry.data ? `${registry.data.commit}, ${registry.data.repo}` : '…',
    ],
  ]
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">About SafeDesk</h2>
        <p className="text-sm text-muted-foreground">
          SafeDesk includes a modified copy of{' '}
          <a
            className="underline"
            href="https://github.com/gskril/plainsafe"
            target="_blank"
            rel="noreferrer"
          >
            PlainSafe
          </a>{' '}
          by Greg Skriloff, developed at ETHGlobal Tokyo 2026. Its MIT license is preserved.
          Upstream commit:{' '}
          <code className="break-all">9a23f9ab38501cf09bb5464b2b5684314e9fb7d5</code>.
        </p>
        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm"
          data-testid="about"
        >
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Dependencies</h3>
        <p className="text-sm text-muted-foreground">
          The runtime packages in this build, at the versions installed when it was built.
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="font-normal">Package</th>
              <th className="font-normal">Version</th>
              <th className="font-normal">License</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {build.dependencies.map((d) => (
              <tr key={d.name}>
                <td className="py-0.5">{d.name}</td>
                <td>{d.version}</td>
                <td>{d.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

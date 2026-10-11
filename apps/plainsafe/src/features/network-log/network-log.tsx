// The network log (SPEC §8.1): every request attempt, allowed or blocked, from this session.
import { Activity } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { netguard } from '@/netguard'
import type { LogEntry } from '@/netguard/log'
import { useLoadedSettings } from '@/queries/settings'
import { groupByHost, type HostGroup, summarizeMethods, tagLabel } from './grouping'
import { useNetLog } from './use-net-log'

const ROWS = 8

const time = (t: number) =>
  new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

/** "12 requests to 1 host this session. 1 blocked, 1 failed." */
export function LogSummary({ entries }: { entries: readonly LogEntry[] }) {
  const hosts = new Set(entries.filter((e) => e.outcome !== 'blocked').map((e) => e.host)).size
  const blocked = entries.filter((e) => e.outcome === 'blocked').length
  const failed = entries.filter((e) => e.outcome === 'failed').length
  return (
    <p className="text-sm" data-testid="network-log-summary">
      {plural(entries.length, 'request')} to {plural(hosts, 'host')} this session.
      {blocked > 0 && (
        <span className="font-medium text-red-700 dark:text-red-400"> {blocked} blocked.</span>
      )}
      {failed > 0 && <span className="text-amber-700 dark:text-amber-400"> {failed} failed.</span>}
    </p>
  )
}

/** Every request, grouped by host: why each host is allowed, then its requests (SPEC §8.1). */
export function NetworkLogList({ entries }: { entries: readonly LogEntry[] }) {
  const settings = useLoadedSettings()
  const { groups, idle } = useMemo(() => groupByHost(entries, settings), [entries, settings])
  return (
    <div className="flex flex-col gap-3" data-testid="network-log">
      {groups.length === 0 && <p className="text-muted-foreground">No network requests yet.</p>}
      {groups.map((g) => (
        <HostCard key={g.host} group={g} />
      ))}
      {idle.map((i) => (
        <section
          key={i.host}
          className="flex items-start gap-3 rounded-lg border border-dashed p-3 text-muted-foreground"
          data-testid="network-log-idle"
        >
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
          <div className="min-w-0">
            <div className="font-mono text-sm break-all">{i.host}</div>
            <div className="text-xs">{i.role.label} · not contacted yet</div>
          </div>
        </section>
      ))}
    </div>
  )
}

function HostCard({ group: g }: { group: HostGroup }) {
  const [all, setAll] = useState(false)
  const shown = all ? g.entries : g.entries.slice(0, ROWS)
  const rpc = g.role.kind === 'rpc'
  const n = g.entries.length
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border',
        g.blocked > 0 && 'border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20',
      )}
      data-testid="network-log-group"
      data-host={g.host}
    >
      <header className="flex items-start gap-3 p-3">
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            g.blocked > 0 ? 'bg-red-500' : g.failed > 0 ? 'bg-amber-500' : 'bg-emerald-500',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold break-all" data-testid="network-log-host">
            {g.host}
          </div>
          <div
            className={cn(
              'text-xs',
              g.role.kind === 'blocked'
                ? 'text-red-700 dark:text-red-400'
                : 'text-sky-800 dark:text-sky-300',
            )}
            data-testid="network-log-role"
          >
            {g.role.label}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <div>
            {plural(n, 'request')}
            {g.calls > 0 && ` · ${plural(g.calls, 'call')}`}
          </div>
          {g.blocked > 0 && (
            <div className="font-medium text-red-700 dark:text-red-400">{g.blocked} blocked</div>
          )}
          {g.failed > 0 && (
            <div className="text-amber-700 dark:text-amber-400">{g.failed} failed</div>
          )}
        </div>
      </header>
      <ol className="divide-y border-t text-xs">
        {shown.map((e) => (
          <li
            key={e.id}
            data-outcome={e.outcome}
            className={cn(
              'grid grid-cols-[4.25rem_8.5rem_1fr] gap-2 px-3 py-1.5',
              e.outcome === 'blocked' && 'bg-red-100/70 dark:bg-red-950/40',
              e.outcome === 'failed' && 'bg-amber-100/70 dark:bg-amber-950/30',
            )}
          >
            <span className="font-mono text-muted-foreground" title={new Date(e.time).toString()}>
              {time(e.time)}
            </span>
            <span className="text-muted-foreground" title={e.tag}>
              {tagLabel(e.tag)}
              {e.source && ` · ${e.source}`}
            </span>
            <span className="min-w-0 font-mono break-words">
              {e.methods.length > 0 ? summarizeMethods(e.methods) : e.transport}
              {/* Your RPC's path is the same every time; other hosts' paths say what was asked */}
              {!rpc && e.path && e.path !== '/' && (
                <span className="block truncate text-muted-foreground" title={e.path}>
                  {e.path}
                </span>
              )}
              {e.outcome === 'blocked' && (
                <span className="block font-sans text-red-700 dark:text-red-400">
                  Blocked. Nothing was sent.
                </span>
              )}
              {e.outcome === 'failed' && (
                <span className="block font-sans break-all text-amber-700 dark:text-amber-400">
                  Failed{e.status !== undefined ? ` (HTTP ${e.status})` : ''}
                  {e.error ? `: ${e.error}` : '.'}
                </span>
              )}
              {e.outcome === 'allowed' &&
                e.status !== undefined &&
                (e.status < 200 || e.status >= 300) && (
                  <span className="block font-sans text-amber-700 dark:text-amber-400">
                    HTTP {e.status}
                  </span>
                )}
            </span>
          </li>
        ))}
      </ol>
      {n > ROWS && (
        <button
          type="button"
          className="w-full border-t px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
          onClick={() => setAll((x) => !x)}
        >
          {all ? 'Show fewer' : `Show ${n - ROWS} more`}
        </button>
      )}
    </section>
  )
}

/** The header indicator: request count, red when anything was blocked. Opens the drawer. */
export function NetworkLogDrawer() {
  const entries = useNetLog()
  const blocked = netguard.log.blockedCount()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Network log: ${entries.length} requests, ${blocked} blocked`}
          data-testid="network-indicator"
          className={cn(blocked > 0 && 'text-red-700 dark:text-red-400')}
        >
          <Activity />
          <span>{entries.length}</span>
          {blocked > 0 && <Badge variant="destructive">{blocked} blocked</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Network log</SheetTitle>
          <SheetDescription>
            Every request this tab attempted since it opened. Plain Safe only contacts your RPCs and
            any capability you turned on.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <LogSummary entries={entries} />
          <NetworkLogList entries={entries} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

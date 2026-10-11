// Settings → Onchain history (SPEC §3.12, §11, P1): which Safes have it on, and their state.
import { Link } from 'wouter'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/errors'
import { shortAddress } from '@/lib/format'
import { useHistoryCheckpoints, useTurnOffHistory } from '@/queries/history'
import { useChainName } from '@/queries/settings'

export function HistorySettings() {
  const list = useHistoryCheckpoints()
  const turnOff = useTurnOffHistory()
  const chainName = useChainName()
  const on = (list.data ?? []).filter((c) => c.enabled)
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Onchain history</h2>
      <p className="text-sm text-muted-foreground">
        Turn it on from a Safe's History view. The scan reads logs over that chain's RPC, runs in
        the background while Plain Safe is open, and is stored only in this browser. It's a cache:
        it isn't in backups and can always be rebuilt.
      </p>
      {on.length === 0 ? (
        <p className="text-sm text-muted-foreground">Off for every Safe.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {on.map((c) => (
            <li key={`${c.chainId}:${c.safe}`} className="flex items-center gap-3 p-3 text-sm">
              <Link
                href={`/safe/${c.chainId}/${c.safe}/history`}
                className="flex-1 font-mono underline underline-offset-2"
              >
                {shortAddress(c.safe)}
              </Link>
              <span className="text-muted-foreground">
                {chainName(c.chainId)} · {c.status ?? 'scanning'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={turnOff.isPending}
                onClick={() => turnOff.mutate({ chainId: c.chainId, safe: c.safe })}
              >
                Turn off
              </Button>
            </li>
          ))}
        </ul>
      )}
      {turnOff.error && <p className="text-sm text-destructive">{describeError(turnOff.error)}</p>}
    </section>
  )
}

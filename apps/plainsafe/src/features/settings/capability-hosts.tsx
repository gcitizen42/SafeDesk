// What a capability contacts (SPEC §8.2): the host in monospace, or a plain note when the host
// depends on the name being looked up (CCIP-read).
import type { CapabilityInfo } from './capabilities'

export function CapabilityHosts({ cap }: { cap: CapabilityInfo }) {
  return (
    <span className="text-xs text-muted-foreground">
      {cap.host && (
        <>
          Contacts <span className="font-mono">{cap.host}</span>
          {cap.note ? '. ' : ''}
        </>
      )}
      {cap.note}
    </span>
  )
}

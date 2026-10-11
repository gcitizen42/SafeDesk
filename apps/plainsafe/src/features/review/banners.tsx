import { Callout } from '@/components/callout'
import type { Banner } from '@/core/safety-rules'

export function SafetyBanners({ banners }: { banners: readonly Banner[] }) {
  if (!banners.length) return null
  return (
    <section className="flex flex-col gap-2" data-testid="banners">
      {banners.map((b) => (
        // A batch can raise the same rule for several calls
        <Callout key={`${b.rule}:${b.call ?? ''}`} severity={b.severity} title={b.title}>
          {b.body}
        </Callout>
      ))}
    </section>
  )
}

// Tokens show a monogram, never a logo: a logoURI could point anywhere (SPEC §8.2).
export function TokenMonogram({ symbol }: { symbol: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold uppercase"
    >
      {symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || '?'}
    </span>
  )
}

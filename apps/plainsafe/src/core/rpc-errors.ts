// Pure helpers for classifying RPC failures (SPEC §7.5 "Detecting support", §8.4).

export interface ErrorInfo {
  readonly code?: number
  readonly status?: number
  readonly message: string
}

/** Walk an error's `cause` chain (viem nests the transport error several levels deep). */
export function causes(e: unknown): unknown[] {
  const out: unknown[] = []
  let cur: unknown = e
  for (let i = 0; cur && i < 10; i++) {
    out.push(cur)
    cur = (cur as { cause?: unknown }).cause
  }
  return out
}

export function errorInfo(e: unknown): ErrorInfo {
  const chain = causes(e)
  const code = chain
    .map((c) => (c as { code?: unknown }).code)
    .find((c): c is number => typeof c === 'number')
  const status = chain
    .map((c) => (c as { status?: unknown }).status)
    .find((s): s is number => typeof s === 'number')
  const messages = chain.flatMap((c) => {
    const x = c as { details?: unknown; shortMessage?: unknown; message?: unknown }
    return [x.details, x.shortMessage, x.message].filter((m): m is string => typeof m === 'string')
  })
  return {
    ...(code !== undefined ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
    message: messages.join(' | ') || String(e),
  }
}

const UNSUPPORTED =
  /method not found|does not exist|not available|not allowed|not whitelisted|unsupported method|method .* not supported|not supported|unknown method/i

/**
 * "Method not found", "not allowed" or "not whitelisted" means unsupported. Rate limits,
 * timeouts or odd responses are temporary (SPEC §7.5).
 */
export function classifyMethodError(info: ErrorInfo): 'unsupported' | 'temporary' {
  if (info.status === 429 || info.code === 429 || info.code === -32005) return 'temporary'
  if (/rate limit|too many requests|timed? ?out|capacity/i.test(info.message)) return 'temporary'
  if (info.code === -32601) return 'unsupported'
  return UNSUPPORTED.test(info.message) ? 'unsupported' : 'temporary'
}

/** A short, human-readable message for display next to the endpoint. */
export function shortMessage(e: unknown): string {
  const x = e as { shortMessage?: unknown; message?: unknown }
  const m =
    typeof x?.shortMessage === 'string'
      ? x.shortMessage
      : typeof x?.message === 'string'
        ? x.message
        : String(e)
  return m.split('\n')[0]?.slice(0, 300) ?? m
}

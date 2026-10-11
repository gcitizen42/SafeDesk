// netguard (SPEC §8.1): every outbound request from this global scope goes through here.
// Framework-free and dependency-free, so it can be installed first in main.tsx and in workers.
import { createNetLog, type EntryPatch, type NetLog, type NewEntry, type Transport } from './log'

export const UNTAGGED = 'untagged'
const CCIP_READ_TAG = 'ccip-read'

export interface Policy {
  /** Allowed origins, e.g. `https://rpc.mevblocker.io` (RPCs plus enabled capability hosts). */
  readonly origins: readonly string[]
  /** CCIP-read capability: any https host, for `ccip-read`-tagged requests only (SPEC §8.2). */
  readonly ccipRead: boolean
}

export class NetguardBlockedError extends TypeError {
  readonly host: string
  constructor(host: string) {
    super(`Blocked by netguard: ${host} is not in the allowlist`)
    this.name = 'NetguardBlockedError'
    this.host = host
  }
}

export interface Netguard {
  readonly log: NetLog
  setPolicy(policy: Policy): void
  getPolicy(): Policy
  /** A fetch that tags its log entries with the part of the app making the request. */
  fetchFor(tag: string): typeof fetch
  /** The only fetch allowed to use the CCIP-read exception. */
  readonly ccipFetch: typeof fetch
}

/** The subset of a global scope netguard touches (Window or WorkerGlobalScope). */
export interface GuardScope {
  fetch: typeof fetch
  location: { href: string; origin: string }
  WebSocket?: typeof WebSocket
  XMLHttpRequest?: typeof XMLHttpRequest
  EventSource?: typeof EventSource
  navigator?: { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean }
}

export interface InstallOptions {
  /** Log source label for workers; entries are also passed to onEntry so the main thread can merge them. */
  source?: string
  /** `id` is this scope's log id, which onUpdate refers to. */
  onEntry?: (entry: NewEntry, id: number) => void
  /** Later changes to an entry (failed, HTTP status), for the main thread's copy. */
  onUpdate?: (id: number, patch: EntryPatch) => void
}

/** JSON-RPC method names from a request body, including batches. */
export function jsonRpcMethods(body: unknown): string[] {
  if (typeof body !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(body)
    const calls = Array.isArray(parsed) ? parsed : [parsed]
    return calls.flatMap((c) =>
      c && typeof c === 'object' && typeof (c as { method?: unknown }).method === 'string'
        ? [(c as { method: string }).method]
        : [],
    )
  } catch {
    return []
  }
}

const INSTALLED = Symbol.for('plainsafe.netguard')

export function installNetguard(scope: GuardScope, options: InstallOptions = {}): Netguard {
  const existing = (scope as unknown as Record<symbol, Netguard | undefined>)[INSTALLED]
  if (existing) return existing

  const log = createNetLog()
  let policy: Policy = { origins: [], ccipRead: false }
  let origins = new Set<string>()
  const own = scope.location.origin
  const ownWs = own.replace(/^http/, 'ws')

  const resolve = (input: string | URL): URL | undefined => {
    try {
      return new URL(String(input), scope.location.href)
    } catch {
      return undefined
    }
  }

  const allowed = (url: URL | undefined, tag: string): boolean => {
    if (!url) return false
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true // no network
    if (url.origin === own || url.origin === ownWs) return true // the app's own files
    if (origins.has(url.origin)) return true
    return tag === CCIP_READ_TAG && policy.ccipRead && url.protocol === 'https:'
  }

  const record = (
    transport: Transport,
    url: URL | undefined,
    tag: string,
    ok: boolean,
    body?: unknown,
  ): number => {
    const entry: NewEntry = {
      transport,
      host: url?.host || url?.protocol || '(invalid URL)',
      path: url?.pathname ?? '',
      methods: jsonRpcMethods(body),
      tag,
      outcome: ok ? 'allowed' : 'blocked',
      ...(options.source ? { source: options.source } : {}),
    }
    const id = log.add(entry)
    options.onEntry?.(entry, id)
    return id
  }
  const update = (id: number, patch: EntryPatch) => {
    log.update(id, patch)
    options.onUpdate?.(id, patch)
  }
  const fail = (id: number, error: string, status?: number) =>
    update(id, { outcome: 'failed', error, ...(status !== undefined ? { status } : {}) })

  // fetch
  const originalFetch = scope.fetch.bind(scope)
  const guardedFetch = (tag: string, input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolve(input instanceof Request ? input.url : input)
    const ok = allowed(url, tag)
    const id = record('fetch', url, tag, ok, init?.body)
    if (!ok) return Promise.reject(new NetguardBlockedError(url?.host ?? String(input)))
    // A redirect is a second request netguard never sees, possibly to another host: refuse them
    // for everything but the app's own files.
    const external = url && url.origin !== own
    return originalFetch(input, external ? { ...init, redirect: 'error' } : init).then(
      (res) => {
        if (res.ok) update(id, { status: res.status })
        else fail(id, `HTTP ${res.status}`, res.status)
        return res
      },
      (err: unknown) => {
        fail(id, err instanceof Error ? err.message : String(err))
        throw err
      },
    )
  }
  const lock = (target: object, key: PropertyKey, value: unknown) =>
    Object.defineProperty(target, key, { value, writable: false, configurable: false })
  lock(scope, 'fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    guardedFetch(UNTAGGED, input, init),
  )

  // WebSocket and EventSource: refuse at construction
  for (const [key, transport] of [
    ['WebSocket', 'websocket'],
    ['EventSource', 'eventsource'],
  ] as const) {
    const Original = scope[key] as (new (url: string | URL, arg?: never) => object) | undefined
    if (!Original) continue
    const Guarded = class extends Original {
      constructor(url: string | URL, arg?: never) {
        const u = resolve(url)
        const ok = allowed(u, UNTAGGED)
        record(transport, u, UNTAGGED, ok)
        if (!ok) throw new NetguardBlockedError(u?.host ?? String(url))
        super(url, arg)
      }
    }
    lock(scope, key, Guarded)
  }

  // XMLHttpRequest
  const XHR = scope.XMLHttpRequest
  if (XHR) {
    const urls = new WeakMap<XMLHttpRequest, URL | undefined>()
    const { open, send } = XHR.prototype
    lock(XHR.prototype, 'open', function (this: XMLHttpRequest, ...args: unknown[]) {
      urls.set(this, resolve(args[1] as string | URL))
      return (open as (...a: unknown[]) => void).apply(this, args)
    })
    lock(
      XHR.prototype,
      'send',
      function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const url = urls.get(this)
        const ok = allowed(url, UNTAGGED)
        const id = record('xhr', url, UNTAGGED, ok, body)
        if (!ok) throw new NetguardBlockedError(url?.host ?? '(unknown)')
        this.addEventListener('loadend', () => {
          if (this.status === 0) fail(id, 'network error')
          else if (this.status >= 400) fail(id, `HTTP ${this.status}`, this.status)
          else update(id, { status: this.status })
        })
        return send.call(this, body)
      },
    )
  }

  // navigator.sendBeacon
  const nav = scope.navigator
  if (nav?.sendBeacon) {
    const original = nav.sendBeacon.bind(nav)
    lock(nav, 'sendBeacon', (target: string | URL, data?: BodyInit | null) => {
      const url = resolve(target)
      const ok = allowed(url, UNTAGGED)
      record('beacon', url, UNTAGGED, ok, data)
      return ok ? original(target, data) : false
    })
  }

  const guard: Netguard = {
    log,
    setPolicy(next) {
      policy = next
      origins = new Set(next.origins)
    },
    getPolicy: () => policy,
    fetchFor(tag) {
      if (tag === CCIP_READ_TAG) throw new Error('Use netguard.ccipFetch for CCIP-read')
      return (input, init) => guardedFetch(tag, input, init)
    },
    ccipFetch: (input, init) => guardedFetch(CCIP_READ_TAG, input, init),
  }
  lock(scope, INSTALLED, guard)
  return guard
}

/** Origin of an RPC or capability URL, for the allowlist. Undefined for non-network URLs. */
export function originOf(url: string): string | undefined {
  try {
    const u = new URL(url)
    return ['https:', 'http:', 'wss:', 'ws:'].includes(u.protocol) ? u.origin : undefined
  } catch {
    return undefined
  }
}

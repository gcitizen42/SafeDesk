// The network log: an in-memory ring buffer (SPEC §8.1). Session-only; never persisted.

export type Outcome = 'allowed' | 'blocked' | 'failed'
export type Transport = 'fetch' | 'websocket' | 'xhr' | 'beacon' | 'eventsource'

export interface LogEntry {
  readonly id: number
  readonly time: number
  readonly transport: Transport
  readonly host: string
  readonly path: string
  /** JSON-RPC methods parsed from the body (one per call in a batch). */
  readonly methods: readonly string[]
  /** Which part of the app made the request, or 'untagged'. */
  readonly tag: string
  readonly outcome: Outcome
  readonly status?: number
  readonly error?: string
  /** Set when the entry came from a worker (SPEC §8.1: one log for the whole app). */
  readonly source?: string
}

export type NewEntry = Omit<LogEntry, 'id' | 'time'>
/** What changes once a request settles: failed, or its HTTP status. */
export type EntryPatch = Partial<Pick<LogEntry, 'outcome' | 'status' | 'error'>>

export interface NetLog {
  add(entry: NewEntry): number
  update(id: number, patch: EntryPatch): void
  subscribe(listener: () => void): () => void
  getSnapshot(): readonly LogEntry[]
  blockedCount(): number
  clear(): void
}

export function createNetLog(capacity = 1000): NetLog {
  let entries: readonly LogEntry[] = []
  let nextId = 1
  let blocked = 0
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const l of listeners) l()
  }

  return {
    add(entry) {
      const id = nextId++
      const full: LogEntry = { ...entry, id, time: Date.now() }
      if (full.outcome === 'blocked') blocked++
      entries = entries.length >= capacity ? [...entries.slice(1), full] : [...entries, full]
      emit()
      return id
    },
    update(id, patch) {
      const i = entries.findIndex((e) => e.id === id)
      if (i < 0) return
      const next = [...entries]
      next[i] = { ...next[i], ...patch } as LogEntry
      entries = next
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => entries,
    blockedCount: () => blocked,
    clear() {
      entries = []
      blocked = 0
      emit()
    },
  }
}

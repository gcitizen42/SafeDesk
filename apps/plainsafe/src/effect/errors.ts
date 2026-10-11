// Tagged errors (SPEC §9.2). The UI shows each one differently, so they stay distinct.
import { Data } from 'effect'

// Storage (SPEC §9.5: invalid records are set aside and reported, never silently used)
export class StorageError extends Data.TaggedError('StorageError')<{
  readonly op: string
  readonly store: string
  readonly cause: unknown
}> {}
export class InvalidRecord extends Data.TaggedError('InvalidRecord')<{
  readonly store: string
  readonly key: string
  readonly message: string
}> {}

// Setup and loading
export class RpcError extends Data.TaggedError('RpcError')<{
  readonly endpoint: string
  readonly message: string
}> {}
export class WrongChain extends Data.TaggedError('WrongChain')<{
  readonly endpoint: string
  readonly expected: number
  readonly actual: number
}> {}

// Network
export class BlockedByNetguard extends Data.TaggedError('BlockedByNetguard')<{
  readonly host: string
}> {}

// Simulation (SPEC §7.5): a simulation that can't run is a warning; one that ran and predicts
// failure is shown in red.
export class SimulationUnavailable extends Data.TaggedError('SimulationUnavailable')<{
  readonly reason: string
}> {}
export class SimulationReverted extends Data.TaggedError('SimulationReverted')<{
  readonly level: 1 | 2
  readonly block: bigint
  readonly reason: string
  readonly gasUsed?: bigint | undefined
}> {}

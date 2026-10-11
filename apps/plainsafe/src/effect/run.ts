import { Cause, type Effect, Exit, type ManagedRuntime } from 'effect'
import { runtime } from './runtime'

export type AppServices = ManagedRuntime.ManagedRuntime.Context<typeof runtime>

/**
 * Run a program for a query or mutation. On failure, throw the tagged error itself (not a
 * FiberFailure), so components can switch on `error._tag`.
 */
export async function run<A, E>(program: Effect.Effect<A, E, AppServices>): Promise<A> {
  const exit = await runtime.runPromiseExit(program)
  if (Exit.isSuccess(exit)) return exit.value
  throw Cause.squash(exit.cause)
}

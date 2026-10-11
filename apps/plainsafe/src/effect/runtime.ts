// The app's one ManagedRuntime (SPEC §9.2). Query hooks call runtime.runPromise(program).
import { Layer, ManagedRuntime } from 'effect'
import { StorageLive } from '@/storage/service'
import { RpcLive } from './rpc'

export const runtime = ManagedRuntime.make(Layer.mergeAll(StorageLive, RpcLive))

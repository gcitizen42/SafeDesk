// The ABI library (SPEC §7.3): pasted ABIs keyed by chainId:implementationCodeHash, so an
// upgraded proxy never keeps using a stale ABI.
import { Effect, Option } from 'effect'
import { AbiRecord, abiKey } from '@/schemas/abi'
import { Storage } from '@/storage/service'

export const getSavedAbi = (chainId: number, codeHash: string) =>
  Effect.flatMap(Storage, (s) => s.get('abis', abiKey(chainId, codeHash), AbiRecord)).pipe(
    Effect.map(Option.getOrUndefined),
  )

export const saveAbi = (record: AbiRecord) =>
  Effect.flatMap(Storage, (s) =>
    s.put('abis', abiKey(record.chainId, record.codeHash), AbiRecord, record),
  )

export const listSavedAbis = Effect.flatMap(Storage, (s) => s.getAll('abis', AbiRecord))

export const removeSavedAbi = (chainId: number, codeHash: string) =>
  Effect.flatMap(Storage, (s) => s.remove('abis', abiKey(chainId, codeHash)))

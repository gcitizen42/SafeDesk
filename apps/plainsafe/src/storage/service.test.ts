import { Effect, Layer, Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/features/settings/defaults'
import { loadSettings, saveSettings } from '@/features/settings/store'
import { makeStorage, memoryBackend, Storage, write } from './service'

const Label = Schema.Struct({ label: Schema.String.pipe(Schema.maxLength(10)) })

function setup() {
  const backend = memoryBackend()
  const layer = Layer.succeed(Storage, makeStorage(backend))
  const run = <A, E>(eff: Effect.Effect<A, E, Storage>) =>
    Effect.runPromise(Effect.either(Effect.provide(eff, layer)))
  return { backend, run }
}

describe('Storage service', () => {
  it('round-trips a record through its schema', async () => {
    const { run } = setup()
    const r = await run(
      Effect.gen(function* () {
        const s = yield* Storage
        yield* s.put('addressbook', '1:0xabc', Label, { label: 'Treasury' })
        return yield* s.get('addressbook', '1:0xabc', Label)
      }),
    )
    expect(r._tag).toBe('Right')
    if (r._tag === 'Right') expect(Option.getOrNull(r.right)).toEqual({ label: 'Treasury' })
  })

  it('reports a record that fails its schema instead of using it', async () => {
    const { backend, run } = setup()
    await backend.put('addressbook', '1:0xabc', { label: 'x'.repeat(50) })
    const r = await run(Effect.flatMap(Storage, (s) => s.get('addressbook', '1:0xabc', Label)))
    expect(r._tag).toBe('Left')
    if (r._tag === 'Left') expect(r.left).toMatchObject({ _tag: 'InvalidRecord', key: '1:0xabc' })
  })

  it('sets aside invalid records in getAll', async () => {
    const { backend, run } = setup()
    await backend.put('addressbook', 'a', { label: 'ok' })
    await backend.put('addressbook', 'b', { label: 42 })
    await backend.put('safes', 'c', { label: 'other store' })
    const r = await run(Effect.flatMap(Storage, (s) => s.getAll('addressbook', Label)))
    expect(r._tag).toBe('Right')
    if (r._tag === 'Right') {
      expect(r.right.records).toEqual([{ key: 'a', value: { label: 'ok' } }])
      expect(r.right.invalid.map((e) => e.key)).toEqual(['b'])
    }
  })

  it('refuses to write a value that does not match its schema', async () => {
    const { backend, run } = setup()
    const r = await run(
      Effect.flatMap(Storage, (s) => s.put('addressbook', 'a', Label, { label: 'x'.repeat(50) })),
    )
    expect(r._tag).toBe('Left')
    expect(backend.data.size).toBe(0)
  })
})

describe('settings store', () => {
  it('returns defaults (setup not done) when nothing is stored, and saves', async () => {
    const { run } = setup()
    expect(await run(loadSettings)).toMatchObject({ right: defaultSettings })
    const done = { ...defaultSettings, setupDone: true, currency: 'EUR' as const }
    await run(saveSettings(done))
    expect(await run(loadSettings)).toMatchObject({ right: done })
  })

  it('rejects a tampered settings record', async () => {
    const { backend, run } = setup()
    await backend.put('settings', 'settings', {
      ...defaultSettings,
      chains: [{ ...defaultSettings.chains[0], rpc: { _tag: 'url', url: 'http://evil.test' } }],
    })
    const r = await run(loadSettings)
    expect(r._tag).toBe('Left')
  })
})

describe('prefix reads and batched writes (history, SPEC §11)', () => {
  it('reads and deletes by key prefix, and writes several stores at once', async () => {
    const { run } = setup()
    const r = await run(
      Effect.gen(function* () {
        const s = yield* Storage
        yield* s.putMany([
          write('history_events', '1:0xabc:10:0', Label, { label: 'a' }),
          write('history_events', '1:0xabc:11:3', Label, { label: 'b' }),
          write('history_events', '1:0xdef:12:0', Label, { label: 'c' }),
          write('history_checkpoints', '1:0xabc', Label, { label: 'cp' }),
        ])
        const abc = yield* s.getAllWithPrefix('history_events', '1:0xabc:', Label)
        yield* s.removePrefix('history_events', '1:0xabc:')
        const after = yield* s.getAll('history_events', Label)
        const cp = yield* s.get('history_checkpoints', '1:0xabc', Label)
        return {
          abc: abc.records.map((x) => x.value.label),
          after: after.records.map((x) => x.key),
          cp,
        }
      }),
    )
    expect(r._tag).toBe('Right')
    if (r._tag !== 'Right') return
    expect(r.right.abc).toEqual(['a', 'b'])
    expect(r.right.after).toEqual(['1:0xdef:12:0'])
    expect(Option.getOrNull(r.right.cp)).toEqual({ label: 'cp' })
  })

  it('writes nothing when one record fails its schema', async () => {
    const { backend, run } = setup()
    const r = await run(
      Effect.flatMap(Storage, (s) =>
        s.putMany([
          write('history_events', 'k1', Label, { label: 'ok' }),
          write('history_events', 'k2', Label, { label: 'x'.repeat(50) }),
        ]),
      ),
    )
    expect(r._tag).toBe('Left')
    expect(backend.data.size).toBe(0)
  })
})

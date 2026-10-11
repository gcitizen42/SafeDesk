import { Effect, Option } from 'effect'
import { Settings } from '@/schemas/settings'
import { Storage } from '@/storage/service'
import { defaultSettings } from './defaults'

export const SETTINGS_KEY = 'settings'

/** Stored settings, or the defaults (with `setupDone: false`) on first run. */
export const loadSettings = Effect.gen(function* () {
  const storage = yield* Storage
  const stored = yield* storage.get('settings', SETTINGS_KEY, Settings)
  return Option.getOrElse(stored, () => defaultSettings)
})

export const saveSettings = (settings: Settings) =>
  Effect.flatMap(Storage, (storage) => storage.put('settings', SETTINGS_KEY, Settings, settings))

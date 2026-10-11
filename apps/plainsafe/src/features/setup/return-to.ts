// Setup navigation state, in memory only (SPEC §9.4: the target is remembered, never persisted).
import { useLocation } from 'wouter'
import type { Settings } from '@/schemas/settings'

let returnTo: string | undefined
let completed = false

export const setReturnTo = (location: string) => {
  returnTo = location
}

/** Go to setup, and come back to this screen once it's done. */
export function useGoToSetup() {
  const [location, navigate] = useLocation()
  return () => {
    setReturnTo(location)
    navigate('/setup')
  }
}

export const takeReturnTo = () => {
  const r = returnTo
  returnTo = undefined
  return r
}

/** Called once settings with `setupDone` are saved, before the query cache catches up. */
export const markSetupCompleted = () => {
  completed = true
}

export const isSetupDone = (settings: Settings) => settings.setupDone || completed

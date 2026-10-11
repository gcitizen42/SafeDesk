// Installs netguard on the main thread. Must be the first import of the app (see src/boot.tsx).
import { type GuardScope, installNetguard } from './guard'

export const netguard = installNetguard(globalThis as unknown as GuardScope)

export { originOf } from './guard'

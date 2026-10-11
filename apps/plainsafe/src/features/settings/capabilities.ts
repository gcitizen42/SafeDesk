// The opt-in capabilities and the exact hosts each one contacts (SPEC §8.2).
import type { Capabilities } from '@/schemas/settings'

type Toggle = Exclude<keyof Capabilities, 'tokenListOrigins'>

export interface CapabilityInfo {
  readonly key: Toggle
  readonly label: string
  readonly usedFor: string
  /** Origins added to the netguard allowlist when on. Empty for CCIP-read (see `note`). */
  readonly origins: readonly string[]
  /** The host it contacts, shown in monospace. Absent when the host isn't known ahead of time. */
  readonly host?: string
  /** Plain-text detail about what it contacts. */
  readonly note?: string
}

export const CAPABILITIES: readonly CapabilityInfo[] = [
  {
    key: 'clearSigningDescriptors',
    label: 'Clear-signing descriptors',
    usedFor:
      'Descriptors for protocols beyond Safe, each checked against a bundled SHA-256 manifest',
    origins: ['https://raw.githubusercontent.com'],
    host: 'raw.githubusercontent.com',
    note: 'Files from the pinned registry commit only.',
  },
  {
    key: 'sourcify',
    label: 'Sourcify',
    usedFor: 'ABIs and verified contract names',
    origins: ['https://sourcify.dev'],
    host: 'sourcify.dev',
  },
  {
    key: 'signatureDatabase',
    label: 'Signature database',
    usedFor: 'Guessed function names for calls with no known ABI',
    origins: ['https://api.4byte.sourcify.dev'],
    host: 'api.4byte.sourcify.dev',
  },
  {
    key: 'ccipRead',
    label: 'ENS off-chain lookups (CCIP-read)',
    usedFor: 'Names stored off-chain, for example *.cb.id or *.uni.eth',
    origins: [],
    note: "Contacts whichever gateway the name's resolver points to, so the host varies by name. Every request still appears in the network log.",
  },
]

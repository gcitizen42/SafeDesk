// Settings record (SPEC §3.12, §9.5). Stored in the `settings` store under one key and decoded
// with this schema on every read.
import { Schema } from 'effect'
import { Address, ChainId, LinkUrl, Origin, RpcUrl } from './common'

export const RpcConfig = Schema.Union(
  Schema.TaggedStruct('url', { url: RpcUrl }),
  /** Reads go through the injected EIP-1193 provider, so the page itself makes no requests. */
  Schema.TaggedStruct('wallet', {}),
)
export type RpcConfig = typeof RpcConfig.Type

const NativeCurrency = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  symbol: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(16)),
  decimals: Schema.Int.pipe(Schema.between(0, 36)),
})

export const ChainSettings = Schema.Struct({
  id: ChainId,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  nativeCurrency: NativeCurrency,
  rpc: RpcConfig,
  /** Only ever linked to, never fetched (SPEC §3.8). */
  explorer: Schema.optional(LinkUrl),
  /** From viem/chains when the chain was added; absent means deployless multicall (SPEC §8.4). */
  multicall3: Schema.optional(Address),
})
export type ChainSettings = typeof ChainSettings.Type

/** Opt-in network capabilities, all off by default (SPEC §8.2). */
export const Capabilities = Schema.Struct({
  /** Origins the user chose to "always allow" for token lists by URL. */
  tokenListOrigins: Schema.Array(Origin),
  clearSigningDescriptors: Schema.Boolean,
  sourcify: Schema.Boolean,
  signatureDatabase: Schema.Boolean,
  ccipRead: Schema.Boolean,
})
export type Capabilities = typeof Capabilities.Type

export const Currency = Schema.Literal('ETH', 'USD', 'EUR')
export type Currency = typeof Currency.Type

export const Settings = Schema.Struct({
  version: Schema.Literal(1),
  setupDone: Schema.Boolean,
  chains: Schema.Array(ChainSettings).pipe(
    Schema.filter(
      (chains) => new Set(chains.map((c) => c.id)).size === chains.length || 'Duplicate chain ID',
    ),
  ),
  capabilities: Capabilities,
  /** ERC-8176 auditors trusted for clear-signing attestations (SPEC §7.2). */
  trustedAuditors: Schema.Array(Schema.String.pipe(Schema.maxLength(200))),
  currency: Currency,
})
export type Settings = typeof Settings.Type

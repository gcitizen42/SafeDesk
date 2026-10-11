// Clear-signing rendering order (SPEC §7.2): formatTypedData on the full SafeTx (its descriptor
// also renders the inner call), then format() on the inner call. Display only: safety warnings
// never come from here (SPEC §7.4).
import {
  type DisplayModel,
  type ExternalDataProvider,
  format,
  formatTypedData,
  isFieldGroup,
  type TrustedTokens,
} from '@ethereum-sourcify/clear-signing'
import { SAFE_TX_TYPE, type SafeTx } from '@/core/safe-tx'
import { shortAddress } from '@/lib/format'
import {
  type DescriptorCache,
  type DescriptorSource,
  loadBundle,
  makeResolver,
  type SafeContext,
  type UserDescriptor,
} from './resolver'

/** Where the descriptors behind a rendering came from, including the library's token template. */
export type RenderSource = DescriptorSource | { readonly kind: 'token-template' }

export interface ClearSigning {
  /** SPEC §7.1: 2 = descriptor without a verified attestation (attestations aren't verified yet). */
  readonly level: 2
  readonly via: 'safe-tx' | 'call'
  readonly display: DisplayModel
  /** The inner call's sentence, when a descriptor renders it. */
  readonly summary?: string
  readonly sources: readonly RenderSource[]
  /** The pinned registry commit the bundled and downloaded files come from. */
  readonly registryCommit: string
}

const UNRESOLVED = new Set([
  'NO_DESCRIPTOR',
  'DESCRIPTOR_FETCH_ERROR',
  'DEPLOYMENT_MISMATCH',
  'NO_FORMAT_MATCH',
  'INVALID_DESCRIPTOR',
])
const resolved = (d: DisplayModel) =>
  !!d.fields?.length && !d.rawCalldataFallback && !d.warnings?.some((w) => UNRESOLVED.has(w.code))

const shorten = (v: string) => v.replace(/0x[0-9a-fA-F]{40}/g, shortAddress)

/** The descriptor's sentence, or its intent followed by the top-level fields. */
function sentence(d: DisplayModel): string | undefined {
  if (d.interpolatedIntent) return shorten(d.interpolatedIntent)
  if (typeof d.intent !== 'string') return undefined
  const parts = (d.fields ?? []).flatMap((f) =>
    isFieldGroup(f) ? [] : [`${f.label.toLowerCase()} ${shorten(f.value)}`],
  )
  return parts.length ? `${d.intent}: ${parts.join(', ')}` : d.intent
}

function innerSummary(d: DisplayModel): string | undefined {
  for (const f of d.fields ?? []) {
    if (isFieldGroup(f)) continue
    const inner = f.embeddedCalldata?.display
    if (inner && resolved(inner)) return sentence(inner)
  }
  return undefined
}

export async function renderClearSigning(
  ctx: SafeContext,
  tx: SafeTx,
  deps: {
    remote: boolean
    userDescriptors: readonly UserDescriptor[]
    externalDataProvider: ExternalDataProvider
    trustedTokens: TrustedTokens
    cache?: DescriptorCache | undefined
  },
): Promise<ClearSigning | undefined> {
  const registryCommit = (await loadBundle()).commit
  const used = new Map<string, DescriptorSource>()
  const resolver = await makeResolver(ctx, {
    remote: deps.remote,
    userDescriptors: deps.userDescriptors,
    cache: deps.cache,
    onUse: (s) => used.set(s.kind === 'user' ? `user:${s.id}` : s.path, s),
  })
  // Plain token calls render from the library's template when no registry file was used.
  const sources = (innerResolved: boolean): RenderSource[] => {
    const list: RenderSource[] = [...used.values()]
    const onlySafe = list.every((s) => s.kind === 'bundled' && s.path.startsWith('registry/safe/'))
    const trusted = deps.trustedTokens[ctx.chainId]?.[tx.to.toLowerCase()]
    return innerResolved && onlySafe && trusted ? [...list, { kind: 'token-template' }] : list
  }
  const opts = {
    descriptorResolverOptions: {
      type: 'custom' as const,
      resolver,
      trustedTokens: deps.trustedTokens,
    },
    externalDataProvider: deps.externalDataProvider,
  }
  const typed = await formatTypedData(
    {
      account: ctx.safe,
      domain: { chainId: ctx.chainId, verifyingContract: ctx.safe },
      types: { SafeTx: SAFE_TX_TYPE.map((t) => ({ ...t })) },
      primaryType: 'SafeTx',
      message: {
        to: tx.to,
        value: tx.value.toString(),
        data: tx.data,
        operation: tx.operation,
        safeTxGas: tx.safeTxGas.toString(),
        baseGas: tx.baseGas.toString(),
        gasPrice: tx.gasPrice.toString(),
        gasToken: tx.gasToken,
        refundReceiver: tx.refundReceiver,
        nonce: tx.nonce.toString(),
      },
    },
    opts,
  )
  if (resolved(typed)) {
    const summary = innerSummary(typed)
    return {
      level: 2,
      via: 'safe-tx',
      display: typed,
      ...(summary ? { summary } : {}),
      sources: sources(summary !== undefined),
      registryCommit,
    }
  }
  if (tx.data === '0x') return undefined
  const call = await format(
    { chainId: ctx.chainId, to: tx.to, data: tx.data, value: tx.value },
    opts,
  )
  if (!resolved(call)) return undefined
  const summary = sentence(call)
  return {
    level: 2,
    via: 'call',
    display: call,
    ...(summary ? { summary } : {}),
    sources: sources(true),
    registryCommit,
  }
}

import { Schema } from 'effect'

const Text = Schema.String.pipe(Schema.maxLength(4096))
const Timestamp = Schema.String.pipe(
  Schema.maxLength(40),
  Schema.filter((value) => Number.isFinite(Date.parse(value))),
)
const Address = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{64}$/))
const Uint = Schema.String.pipe(Schema.pattern(/^(0|[1-9]\d{0,77})$/))
const Weight = Schema.Int.pipe(Schema.between(1, 255))
const Member = Schema.Struct({
  publicKey: Schema.String.pipe(Schema.maxLength(128)),
  weight: Weight,
  address: Schema.optional(Address),
  role: Schema.optional(Schema.Literal('msafe-specifier')),
})
const Policy = Schema.Struct({
  threshold: Schema.Int.pipe(Schema.between(1, 65535)),
  members: Schema.Array(Member).pipe(Schema.minItems(2), Schema.maxItems(10)),
  creationNonce: Schema.optional(Schema.Int.pipe(Schema.between(0, 4294967295))),
  address: Schema.optional(Address),
})
const TargetPolicy = Schema.Struct({
  threshold: Policy.fields.threshold,
  creationNonce: Policy.fields.creationNonce,
  address: Policy.fields.address,
  members: Schema.Array(
    Schema.Struct({
      publicKey: Schema.optional(Member.fields.publicKey),
      weight: Weight,
      address: Schema.optional(Address),
      role: Member.fields.role,
    }),
  ).pipe(Schema.minItems(2), Schema.maxItems(10)),
})
const VerifiedPolicy = Schema.Struct({
  ...Policy.fields,
  address: Address,
  members: Schema.Array(Schema.Struct({ ...Member.fields, address: Address })).pipe(
    Schema.minItems(2),
    Schema.maxItems(10),
  ),
  source: Text,
  ownerCount: Schema.optional(Schema.Int.pipe(Schema.between(1, 10))),
})
const ObjectEntry = Schema.Struct({
  objectId: Address,
  type: Text,
  version: Uint,
  digest: Text,
  kind: Schema.Literal('coin', 'sui-gas', 'privileged', 'object'),
  selectable: Schema.Boolean,
})
const Warnings = Schema.Array(Text).pipe(Schema.maxItems(100))
const RecordValue = Schema.Record({ key: Schema.String, value: Schema.Unknown })
const Inspection = Schema.Struct({
  network: Schema.Literal('sui:mainnet'),
  checkedAt: Timestamp,
  chainIdentifier: Text,
  vault: Address,
  complete: Schema.Boolean,
  policy: Schema.NullOr(VerifiedPolicy),
  signerMember: Schema.NullOr(Schema.Boolean),
  balances: Schema.Array(
    Schema.Struct({
      coinType: Text,
      balance: Uint,
      symbol: Schema.optional(Text),
      decimals: Schema.optional(Schema.Int.pipe(Schema.between(0, 255))),
    }),
  ).pipe(Schema.maxItems(1000)),
  objects: Schema.Array(ObjectEntry).pipe(Schema.maxItems(1000)),
  warnings: Warnings,
})
const Plan = Schema.Struct({
  schema: Schema.Literal('safedesk-sui-migration-v1'),
  network: Schema.Literal('sui:mainnet'),
  createdAt: Timestamp,
  sourceVault: Address,
  destinationVault: Address,
  sourcePolicy: RecordValue,
  targetPolicy: RecordValue,
  selectedObjects: Schema.Array(RecordValue).pipe(Schema.minItems(1), Schema.maxItems(50)),
  remainingObjectIds: Schema.Array(Address).pipe(Schema.maxItems(1000)),
  acknowledgements: Schema.Struct({
    destination: Schema.Literal(true),
    privileged: Schema.Boolean,
    capabilitySelectionHash: Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/)),
  }),
  warnings: Warnings,
  transaction: RecordValue,
  transactionJson: Schema.String.pipe(Schema.maxLength(1024 * 1024)),
  transactionBytes: Schema.String.pipe(
    Schema.maxLength(2 * 1024 * 1024),
    Schema.pattern(/^[A-Za-z0-9+/]+={0,2}$/),
  ),
  transactionDigest: Text.pipe(Schema.minLength(1)),
  packageHash: Text.pipe(Schema.minLength(1)),
  buildOnly: Schema.Literal(true),
})
const Simulation = Schema.Struct({
  status: Schema.Literal('passed', 'failed'),
  checkedAt: Timestamp,
  transactionDigest: Text,
  packageHash: Text,
  gasPaymentMocked: Schema.Boolean,
  authorizationVerified: Schema.Literal(false),
  gasUsed: RecordValue,
  balanceChanges: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(1000)),
  changedObjects: Schema.Array(Schema.Unknown).pipe(Schema.maxItems(1000)),
  checksEnabled: Schema.Literal(true),
  warnings: Warnings,
})

export type SuiPolicy = typeof Policy.Type
export type SuiTargetPolicy = typeof TargetPolicy.Type
export type SuiInspection = typeof Inspection.Type
export type SuiObject = typeof ObjectEntry.Type
export type SuiPlan = typeof Plan.Type
export type SuiSimulation = typeof Simulation.Type

export interface SuiInputs {
  readonly vault: string
  readonly signer: string
  readonly evidenceDigest: string
  readonly sourcePolicyJson: string
  readonly targetPolicyJson: string
  readonly targetThreshold: string
  readonly objectIds: readonly string[]
  readonly ackPrivileged: boolean
  readonly ackDestination: boolean
}

export const blankInputs: SuiInputs = {
  vault: '',
  signer: '',
  evidenceDigest: '',
  sourcePolicyJson: '',
  targetPolicyJson: '',
  targetThreshold: '',
  objectIds: [],
  ackPrivileged: false,
  ackDestination: false,
}

export function formatSuiBalance(balance: string, decimals?: number): string {
  if (!/^(0|[1-9]\d{0,77})$/.test(balance)) throw new Error('Invalid balance')
  if (decimals === undefined) return `${balance} raw units`
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error('Invalid decimals')
  if (decimals === 0) return balance
  const padded = balance.padStart(decimals + 1, '0')
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  const whole = padded.slice(0, -decimals)
  return fraction ? `${whole}.${fraction}` : whole
}

function assertPublicDocument(value: unknown, depth = 0) {
  if (depth > 32) throw new Error('Policy JSON is too deeply nested.')
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (/private|secret|mnemonic|seed|password|token|signature/i.test(key))
      throw new Error('Only public policy fields are accepted; remove sensitive fields.')
    assertPublicDocument(item, depth + 1)
  }
}

export function suiAddress(text: string): string {
  const value = text.trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value))
    throw new Error('Enter a full nonzero Sui address.')
  return value.toLowerCase()
}

/** Native derivation and MSafe nonce-marker validation stay with the backend. */
export function publicPolicy(input: unknown): { policy: SuiPolicy; address?: string } {
  let policy: SuiPolicy
  try {
    policy = Schema.decodeUnknownSync(Policy)(input)
  } catch {
    throw new Error(
      'Policy requires a threshold and 2 to 10 public keys with weights from 1 to 255.',
    )
  }
  const seen = new Set<string>()
  for (const member of policy.members) {
    checkPublicKey(member.publicKey)
    if (seen.has(member.publicKey)) throw new Error('Public keys must be unique.')
    seen.add(member.publicKey)
  }
  if (
    policy.threshold >
    policy.members
      .filter((member) => member.role !== 'msafe-specifier')
      .reduce((sum, member) => sum + member.weight, 0)
  )
    throw new Error('Threshold exceeds total member weight.')
  return { policy, ...(policy.address ? { address: suiAddress(policy.address) } : {}) }
}

function checkPublicKey(key: string) {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error('Invalid base64')
    const bytes = atob(key)
    if (btoa(bytes) !== key) throw new Error('Noncanonical base64')
    const flag = bytes.charCodeAt(0)
    if ((flag !== 0 || bytes.length !== 33) && (![1, 2].includes(flag) || bytes.length !== 34))
      throw new Error('Unsupported key format')
  } catch {
    throw new Error('Enter serialized ED25519, Secp256k1 or Secp256r1 public keys.')
  }
}

function policyDocument(text: string, side: 'source' | 'target', threshold?: string) {
  if (!text.trim() || text.length > 32 * 1024) throw new Error('Enter public policy JSON.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Policy must be valid JSON.')
  }
  assertPublicDocument(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const doc = value as Record<string, unknown>
    value = doc[side === 'source' ? 'sourcePolicy' : 'targetPolicy'] ?? doc.policy ?? doc
  }
  if (threshold?.trim()) {
    if (!/^\d{1,5}$/.test(threshold.trim()))
      throw new Error('Enter a whole threshold from 1 to 65535.')
    value = { ...(value as object), threshold: Number(threshold) }
  }
  return value
}

export function policyJson(text: string, side: 'source' | 'target', threshold?: string) {
  return publicPolicy(policyDocument(text, side, threshold))
}

export function targetPolicyJson(
  text: string,
  threshold?: string,
): { policy: SuiTargetPolicy; address?: string } {
  let policy: SuiTargetPolicy
  const document = policyDocument(text, 'target', threshold)
  try {
    policy = Schema.decodeUnknownSync(TargetPolicy)(document)
  } catch {
    throw new Error('Target policy requires valid JSON, a threshold and 2 to 10 weighted members.')
  }
  const seen = new Set<string>()
  for (const member of policy.members) {
    if (!member.publicKey && !member.address)
      throw new Error('Each target member needs an address or public key.')
    if (member.publicKey) checkPublicKey(member.publicKey)
    const key = member.publicKey ?? suiAddress(member.address as string)
    if (seen.has(key)) throw new Error('Target members must be unique.')
    seen.add(key)
  }
  if (policy.threshold > policy.members.reduce((sum, member) => sum + member.weight, 0))
    throw new Error('Target threshold exceeds the total member weight.')
  return policy.members.every((member) => member.publicKey) ? publicPolicy(policy) : { policy }
}

export function inspectInput(inputs: SuiInputs) {
  const vault = suiAddress(inputs.vault)
  const signer = inputs.signer.trim() ? suiAddress(inputs.signer) : undefined
  const evidenceDigest = inputs.evidenceDigest.trim() || undefined
  if (evidenceDigest && !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(evidenceDigest))
    throw new Error('Enter a valid Sui evidence transaction digest.')
  const source = inputs.sourcePolicyJson.trim()
    ? policyJson(inputs.sourcePolicyJson, 'source')
    : undefined
  if (source?.address && source.address !== vault)
    throw new Error('Source policy address does not match this vault.')
  return {
    vault,
    ...(signer ? { signer } : {}),
    ...(evidenceDigest ? { evidenceDigest } : {}),
    ...(source ? { sourcePolicy: source.policy } : {}),
  }
}

export function selectableObject(object: SuiObject, ackPrivileged: boolean) {
  return (
    object.selectable &&
    object.kind !== 'sui-gas' &&
    (object.kind !== 'privileged' || ackPrivileged)
  )
}

export function planInput(inputs: SuiInputs, inspection: SuiInspection | undefined) {
  const source = inspectInput(inputs)
  if (!inspection?.policy || inspection.vault.toLowerCase() !== source.vault)
    throw new Error('Inspect and verify the source public policy first.')
  if (!inspection.complete)
    throw new Error('A complete source inventory is required before building.')
  if (source.signer && inspection.signerMember !== true)
    throw new Error('The inspected signer is not a verified source member.')
  if (!inputs.targetThreshold.trim()) throw new Error('Enter the target threshold weight.')
  const target = targetPolicyJson(inputs.targetPolicyJson, inputs.targetThreshold)
  if (target.address === source.vault)
    throw new Error('Target policy must derive a different destination vault.')
  if (!inputs.ackDestination)
    throw new Error('Target keys and threshold must be verified by owners.')
  if (!inputs.objectIds.length || inputs.objectIds.length > 50)
    throw new Error('Select 1 to 50 transferable objects.')
  const ids = [...new Set(inputs.objectIds)]
  for (const id of ids) {
    const object = inspection.objects.find((o) => o.objectId === id)
    if (!object || !selectableObject(object, inputs.ackPrivileged))
      throw new Error('Selected objects are not transferable under the current acknowledgments.')
  }
  return {
    ...source,
    sourcePolicy: publicPolicy(inspection.policy).policy,
    targetPolicy: target.policy,
    objectIds: ids,
    ackPrivileged: inputs.ackPrivileged,
    ackDestination: inputs.ackDestination,
  }
}

export function parseInspection(
  input: unknown,
  request: ReturnType<typeof inspectInput>,
): SuiInspection {
  const inspected = Schema.decodeUnknownSync(Inspection)(input)
  if (suiAddress(inspected.vault) !== request.vault) throw new Error('Mismatched inspection')
  if (inspected.policy && suiAddress(inspected.policy.address) !== request.vault)
    throw new Error('Mismatched source policy')
  if (inspected.policy) publicPolicy(inspected.policy)
  if (inspected.policy) {
    const ownerCount = inspected.policy.members.filter(
      (member) => member.role !== 'msafe-specifier',
    ).length
    if (inspected.policy.ownerCount !== undefined && inspected.policy.ownerCount !== ownerCount)
      throw new Error('Mismatched owner count')
  }
  if (
    new Set(inspected.objects.map((o) => o.objectId.toLowerCase())).size !==
    inspected.objects.length
  )
    throw new Error('Duplicate inventory')
  return inspected
}

export function parsePlan(input: unknown, request: ReturnType<typeof planInput>): SuiPlan {
  const plan = Schema.decodeUnknownSync(Plan)(input)
  if (
    plan.acknowledgements.destination !== request.ackDestination ||
    plan.acknowledgements.privileged !== request.ackPrivileged
  )
    throw new Error('Mismatched acknowledgements')
  const target = publicPolicy(plan.targetPolicy)
  const source = publicPolicy(plan.sourcePolicy)
  const destination = suiAddress(plan.destinationVault)
  if (
    suiAddress(plan.sourceVault) !== request.vault ||
    destination === request.vault ||
    (target.address && target.address !== destination) ||
    (source.address && source.address !== request.vault) ||
    (request.targetPolicy.address && suiAddress(request.targetPolicy.address) !== destination) ||
    target.policy.threshold !== request.targetPolicy.threshold ||
    (request.targetPolicy.creationNonce !== undefined &&
      target.policy.creationNonce !== request.targetPolicy.creationNonce) ||
    target.policy.members.length < request.targetPolicy.members.length ||
    target.policy.members.length >
      request.targetPolicy.members.length +
        (request.targetPolicy.creationNonce !== undefined ? 1 : 0) ||
    request.targetPolicy.members.some((requested, index) => {
      const member = target.policy.members[index]
      return (
        !member ||
        requested.weight !== member.weight ||
        (requested.publicKey !== undefined && requested.publicKey !== member.publicKey) ||
        (requested.address !== undefined &&
          (!member.address || suiAddress(requested.address) !== suiAddress(member.address)))
      )
    })
  )
    throw new Error('Mismatched plan policy')
  const selected = plan.selectedObjects.map((o) => suiAddress(String(o.objectId)))
  if (
    new Set(selected).size !== selected.length ||
    selected.length !== request.objectIds.length ||
    selected.some((id) => !request.objectIds.includes(id))
  )
    throw new Error('Mismatched selected objects')
  const json = JSON.parse(plan.transactionJson)
  if (
    json.version !== 2 ||
    !Array.isArray(json.inputs) ||
    !Array.isArray(json.commands) ||
    !json.gasData
  )
    throw new Error('Expected Mysten V2 JSON')
  if (JSON.stringify(json) !== JSON.stringify(plan.transaction) || json.sender !== request.vault)
    throw new Error('Mismatched native transaction')
  return plan
}

export function parseSimulation(input: unknown, plan: SuiPlan): SuiSimulation {
  const simulation = Schema.decodeUnknownSync(Simulation)(input)
  if (simulation.status === 'passed' && simulation.gasPaymentMocked !== false)
    throw new Error('Mocked gas cannot pass simulation')
  if (
    simulation.packageHash !== plan.packageHash ||
    simulation.transactionDigest !== plan.transactionDigest
  )
    throw new Error('Mismatched simulation')
  return simulation
}

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  blankInputs,
  formatSuiBalance,
  inspectInput,
  parseInspection,
  parsePlan,
  parseSimulation,
  planInput,
  policyJson,
  publicPolicy,
  type SuiInputs,
  type SuiInspection,
  type SuiPlan,
  targetPolicyJson,
} from './model'
import { OtherChainsScreen } from './other-chains-screen'
import {
  createSuiSession,
  requestSui,
  type SuiRequest,
  type SuiSession,
  suiAvailability,
} from './session'

const address = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const key = (n: number) => btoa(String.fromCharCode(0) + String.fromCharCode(n).repeat(32))
const vault = address(100)
const destination = address(101)
const objectId = address(200)
const gasId = address(201)
const capId = address(202)
const digest = '1'.repeat(44)
const sourcePolicy = {
  address: vault,
  threshold: 6,
  ownerCount: 9,
  creationNonce: 12,
  members: Array.from({ length: 10 }, (_, index) => ({
    publicKey: key(index + 1),
    weight: 1,
    address: address(index + 1),
    ...(index === 9 ? { role: 'msafe-specifier' as const } : {}),
  })),
  source: 'fixture-address-binding',
}
const targetPolicy = {
  threshold: 2,
  members: [
    { publicKey: key(20), address: address(20), weight: 1 },
    { publicKey: key(21), address: address(21), weight: 1 },
  ],
}

function inspection(overrides: Partial<SuiInspection> = {}): SuiInspection {
  return {
    network: 'sui:mainnet',
    checkedAt: new Date().toISOString(),
    chainIdentifier: 'fixture',
    vault,
    complete: true,
    policy: sourcePolicy,
    signerMember: null,
    balances: [{ coinType: 'fixture::coin::TEST', balance: '9007199254740993123' }],
    objects: [
      {
        objectId,
        type: 'fixture::coin::TEST',
        version: '5',
        digest,
        kind: 'coin',
        selectable: true,
      },
      {
        objectId: gasId,
        type: 'fixture::coin::SUI',
        version: '6',
        digest,
        kind: 'sui-gas',
        selectable: false,
      },
      {
        objectId: capId,
        type: 'fixture::AdminCap',
        version: '7',
        digest,
        kind: 'privileged',
        selectable: true,
      },
    ],
    warnings: [],
    ...overrides,
  }
}

function plan(overrides: Partial<SuiPlan> = {}): SuiPlan {
  const transaction = {
    version: 2,
    sender: vault,
    expiration: { Epoch: '99' },
    gasData: {
      budget: '50000000',
      price: '1000',
      owner: vault,
      payment: [{ objectId: gasId, version: '6', digest }],
    },
    inputs: [
      { Object: { ImmOrOwnedObject: { objectId, version: '5', digest } } },
      { Pure: { bytes: btoa('destination') } },
    ],
    commands: [{ TransferObjects: { objects: [{ Input: 0 }], address: { Input: 1 } } }],
  }
  return {
    schema: 'safedesk-sui-migration-v1',
    network: 'sui:mainnet',
    createdAt: new Date().toISOString(),
    sourceVault: vault,
    destinationVault: destination,
    sourcePolicy,
    targetPolicy: { ...targetPolicy, address: destination },
    selectedObjects: [inspection().objects[0] as unknown as Record<string, unknown>],
    remainingObjectIds: [gasId, capId],
    acknowledgements: {
      destination: true,
      privileged: false,
      capabilitySelectionHash: 'b'.repeat(64),
    },
    warnings: ['Fixture unsigned migration.'],
    transaction,
    transactionJson: JSON.stringify(transaction),
    transactionBytes: 'AQID',
    transactionDigest: digest,
    packageHash: 'a'.repeat(64),
    buildOnly: true,
    ...overrides,
  }
}

function simulation(overrides: Record<string, unknown> = {}) {
  return {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    transactionDigest: digest,
    packageHash: 'a'.repeat(64),
    gasPaymentMocked: false,
    authorizationVerified: false,
    gasUsed: {},
    balanceChanges: [],
    changedObjects: [],
    checksEnabled: true,
    warnings: [],
    ...overrides,
  }
}

const configuredInputs = (): SuiInputs => ({
  ...blankInputs,
  vault,
  targetPolicyJson: JSON.stringify(targetPolicy),
  targetThreshold: '2',
  objectIds: [objectId],
  ackDestination: true,
})
const html = (session: SuiSession) =>
  renderToStaticMarkup(createElement(OtherChainsScreen, { session }))
const disabled = (markup: string, label: string) =>
  new RegExp(`<button[^>]*aria-label="${label}"[^>]*disabled`).test(markup)

function deferred() {
  let resolve: (value: unknown) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function configuredSession(
  request: Mock<SuiRequest> = vi.fn<SuiRequest>(async (action) =>
    action === 'inspect' ? inspection() : plan(),
  ),
) {
  const session = createSuiSession(request)
  session.edit({ vault, targetPolicyJson: JSON.stringify(targetPolicy), targetThreshold: '2' })
  await session.inspect()
  session.toggleObject(objectId, true)
  session.edit({ ackDestination: true })
  return { session, request }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Sui public input and response boundaries', () => {
  it('formats metadata-backed balances with exact decimal string arithmetic and labels unknown units', () => {
    expect(formatSuiBalance('9007199254740993123', 9)).toBe('9007199254.740993123')
    expect(formatSuiBalance('123000000', 9)).toBe('0.123')
    expect(formatSuiBalance('0', 9)).toBe('0')
    expect(formatSuiBalance('99', 0)).toBe('99')
    expect(formatSuiBalance('9007199254740993123')).toBe('9007199254740993123 raw units')
    expect(() => formatSuiBalance('01', 9)).toThrow()
  })

  it('rejects nested sensitive fields before schema decoding and never sends them', async () => {
    for (const field of [
      'privateKey',
      'seed',
      'mnemonic',
      'password',
      'secretToken',
      'signature',
    ]) {
      const policy = { ...targetPolicy, extra: { [field]: 'synthetic-test-only' } }
      expect(() => targetPolicyJson(JSON.stringify(policy))).toThrow('sensitive fields')
      expect(() => policyJson(JSON.stringify(policy), 'source')).toThrow('sensitive fields')
    }
    const request = vi.fn()
    const session = createSuiSession(request)
    session.edit({
      vault,
      sourcePolicyJson: JSON.stringify({ ...sourcePolicy, seed: 'synthetic-test-only' }),
    })
    await session.inspect()
    expect(request).not.toHaveBeenCalled()
    expect(session.getSnapshot().error).toContain('sensitive fields')
  })
  it('starts blank and accepts public source JSON pasted from inspection and optional evidence', () => {
    expect(
      inspectInput({
        ...blankInputs,
        vault,
        sourcePolicyJson: JSON.stringify(inspection()),
        evidenceDigest: digest,
      }),
    ).toMatchObject({
      vault,
      sourcePolicy: { threshold: 6, creationNonce: 12, members: expect.any(Array) },
      evidenceDigest: digest,
    })
    expect(policyJson(JSON.stringify({ sourcePolicy }), 'source').policy.members).toHaveLength(10)
    expect(targetPolicyJson(JSON.stringify({ targetPolicy })).policy).toEqual(targetPolicy)
    expect(() => inspectInput(blankInputs)).toThrow('address')
    expect(() => inspectInput({ ...blankInputs, vault, signer: 'private-rpc.invalid' })).toThrow(
      'address',
    )
    expect(() => inspectInput({ ...blankInputs, vault, evidenceDigest: 'not a digest' })).toThrow(
      'digest',
    )
    expect(() =>
      inspectInput({
        ...blankInputs,
        vault,
        sourcePolicyJson: JSON.stringify({ ...sourcePolicy, address: destination }),
      }),
    ).toThrow('does not match')
  })

  it('supports address-only target members and optional MSafe creation nonce without inventing public keys', () => {
    const input = {
      threshold: 2,
      creationNonce: 0,
      members: [
        { address: address(20), weight: 1 },
        { address: address(21), weight: 1 },
      ],
    }
    expect(targetPolicyJson(JSON.stringify(input))).toEqual({ policy: input })
    const body = planInput(
      { ...configuredInputs(), targetPolicyJson: JSON.stringify(input) },
      inspection(),
    )
    expect(body.targetPolicy).toEqual(input)
    const resolved = {
      ...targetPolicy,
      address: destination,
      creationNonce: 0,
      ownerCount: 2,
      members: [
        ...targetPolicy.members,
        { publicKey: key(22), address: address(22), weight: 1, role: 'msafe-specifier' },
      ],
    }
    expect(parsePlan(plan({ targetPolicy: resolved }), body).targetPolicy).toEqual(resolved)
  })

  it('rejects code, address lists without policy structure, malformed public keys and weighted thresholds', () => {
    for (const text of [
      'alert(1)',
      '[]',
      JSON.stringify({ threshold: 2, members: [address(20), address(21)] }),
      JSON.stringify({ threshold: 3, members: targetPolicy.members }),
      JSON.stringify({
        threshold: 1,
        members: [{ publicKey: 'secret', weight: 1 }, targetPolicy.members[1]],
      }),
      JSON.stringify({ ...targetPolicy, creationNonce: -1 }),
    ]) {
      expect(() => targetPolicyJson(text)).toThrow()
    }
    expect(() =>
      publicPolicy({ threshold: 1, members: [targetPolicy.members[0], targetPolicy.members[0]] }),
    ).toThrow('unique')
    expect(() => targetPolicyJson(JSON.stringify(targetPolicy), '1.5')).toThrow()
    expect(() =>
      policyJson(
        JSON.stringify({
          ...targetPolicy,
          members: [
            { address: address(20), weight: 1 },
            { address: address(21), weight: 1 },
          ],
        }),
        'source',
      ),
    ).toThrow()
  })

  it('requires complete inspection, source policy, exact selections and both capability/destination acknowledgments', () => {
    const inputs = configuredInputs()
    for (const inspected of [
      undefined,
      inspection({ policy: null }),
      inspection({ complete: false }),
    ])
      expect(() => planInput(inputs, inspected)).toThrow()
    expect(() => planInput({ ...inputs, objectIds: [] }, inspection())).toThrow('Select')
    expect(() => planInput({ ...inputs, ackDestination: false }, inspection())).toThrow(
      'verified by owners',
    )
    expect(() => planInput({ ...inputs, objectIds: [gasId] }, inspection())).toThrow(
      'not transferable',
    )
    expect(() => planInput({ ...inputs, objectIds: [capId] }, inspection())).toThrow(
      'not transferable',
    )
    expect(
      planInput({ ...inputs, objectIds: [capId], ackPrivileged: true }, inspection()).objectIds,
    ).toEqual([capId])
    expect(() =>
      planInput({ ...inputs, signer: address(1) }, inspection({ signerMember: false })),
    ).toThrow('signer')
  })

  it('rejects mismatched vaults, objects, transaction JSON, destination metadata and simulation bindings', () => {
    expect(() =>
      parseInspection(inspection({ vault: destination }), inspectInput(configuredInputs())),
    ).toThrow()
    expect(() =>
      parseInspection(
        inspection({ objects: [inspection().objects[0], inspection().objects[0]] }),
        inspectInput(configuredInputs()),
      ),
    ).toThrow()
    const body = planInput(configuredInputs(), inspection())
    expect(parsePlan(plan(), body).acknowledgements).toEqual(plan().acknowledgements)
    expect(() =>
      parsePlan(
        plan({
          acknowledgements: {
            destination: true,
            privileged: true,
            capabilitySelectionHash: 'b'.repeat(64),
          },
        }),
        body,
      ),
    ).toThrow()
    expect(() =>
      parsePlan(
        plan({
          acknowledgements: { destination: true, privileged: false, capabilitySelectionHash: '' },
        }),
        body,
      ),
    ).toThrow()
    expect(() => parsePlan(plan({ sourceVault: destination }), body)).toThrow()
    expect(() => parsePlan(plan({ selectedObjects: [{ objectId: gasId }] }), body)).toThrow()
    expect(() => parsePlan(plan({ transactionJson: '{}' }), body)).toThrow()
    expect(() =>
      parsePlan(plan({ transaction: { ...plan().transaction, sender: destination } }), body),
    ).toThrow()
    expect(() =>
      parsePlan(plan(), { ...body, targetPolicy: { ...body.targetPolicy, address: vault } }),
    ).toThrow()
    expect(() =>
      parseSimulation(
        {
          status: 'passed',
          checkedAt: new Date().toISOString(),
          transactionDigest: digest,
          packageHash: 'wrong',
          gasPaymentMocked: true,
          authorizationVerified: false,
          gasUsed: {},
          balanceChanges: [],
          changedObjects: [],
          checksEnabled: true,
          warnings: [],
        },
        plan(),
      ),
    ).toThrow()
  })
})

describe('React Sui workflow with explicit, revision-bound requests', () => {
  it('renders blank forms, disabled exports, and real Starknet inspection-pending status without requests', () => {
    const request = vi.fn()
    const session = createSuiSession(request)
    const markup = html(session)
    expect(markup).toContain('Inspection pending')
    expect(markup).toContain('Starknet')
    expect(markup).toContain('value=""')
    expect(markup).not.toContain('0x313b')
    expect(markup).not.toContain('Connect wallet')
    expect(disabled(markup, 'Copy MSafe Plain Transaction')).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('reports invalid form input without sending a request', async () => {
    const request = vi.fn()
    const session = createSuiSession(request)
    session.edit({ vault: 'not an address', targetPolicyJson: '(() => secret)()' })
    await session.inspect()
    await session.build()
    const markup = html(session)
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('valid JSON')
    expect(disabled(markup, 'Copy MSafe Plain Transaction')).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('displays 6 / 9 owners separately from the reserved tenth native key and preserves exact balances', async () => {
    const { session } = await configuredSession()
    const markup = html(session)
    expect(markup).toContain('Threshold weight 6 / 9 owners / 10 native keys')
    expect(markup).toContain('MSafe specifier (reserved)')
    expect(markup).toContain('private-key availability not verified')
    expect(markup).toContain('9007199254740993123 raw units')
    expect(session.getSnapshot().inputs.objectIds).toEqual([objectId])
    session.toggleObject(gasId, true)
    session.toggleObject(capId, true)
    expect(session.getSnapshot().inputs.objectIds).toEqual([objectId])
    session.edit({ ackPrivileged: true })
    session.toggleObject(capId, true)
    expect(session.getSnapshot().inputs.objectIds).toEqual([objectId, capId])
    session.edit({ ackPrivileged: false })
    expect(session.getSnapshot().inputs.objectIds).toEqual([objectId])
  })

  it('enables only the built transaction JSON and separate review package; all edits immediately invalidate exports', async () => {
    const { session, request } = await configuredSession()
    await session.build()
    const before = html(session)
    expect(disabled(before, 'Copy MSafe Plain Transaction')).toBe(true)
    expect(suiAvailability(session.getSnapshot()).reviewable).toBe(true)
    expect(before).toContain('Built MSafe Plain Transaction JSON')
    expect(before).toContain('Review package')
    expect(session.getSnapshot().plan?.transactionJson).toBe(plan().transactionJson)
    expect(before).not.toContain('Approved')
    expect(request.mock.calls.map(([action]) => action)).toEqual(['inspect', 'plan'])
    request.mockResolvedValueOnce(simulation())
    await session.simulate()
    expect(disabled(html(session), 'Copy MSafe Plain Transaction')).toBe(false)
    expect(disabled(html(session), 'Download MSafe Plain Transaction')).toBe(false)
    session.edit({ targetThreshold: '1' })
    expect(session.getSnapshot().plan).toBeUndefined()
    expect(session.getSnapshot().simulation).toBeUndefined()
    expect(session.getSnapshot().inputs.ackDestination).toBe(false)
    const after = html(session)
    expect(disabled(after, 'Copy MSafe Plain Transaction')).toBe(true)
    expect(after).not.toContain('Built MSafe Plain Transaction JSON')
  })

  it('renders exact human units when coin metadata is known', async () => {
    const { session } = await configuredSession(
      vi.fn<SuiRequest>(async (action) =>
        action === 'inspect'
          ? inspection({
              balances: [
                {
                  coinType: 'fixture::TEST',
                  balance: '9007199254740993123',
                  symbol: 'TEST',
                  decimals: 9,
                },
              ],
            })
          : plan(),
      ),
    )
    expect(html(session)).toContain('9007199254.740993123 TEST')
    expect(html(session)).toContain('fixture::TEST')
  })

  it('clears a previous passing simulation before retries, and never exports after failure or mocked-gas passing claims', async () => {
    const { session, request } = await configuredSession()
    await session.build()
    request.mockResolvedValueOnce(simulation())
    await session.simulate()
    expect(suiAvailability(session.getSnapshot()).exportable).toBe(true)
    expect(disabled(html(session), 'Download native Sui simulation JSON')).toBe(false)
    request.mockRejectedValueOnce(new Error('private SDK URL'))
    const retry = session.simulate()
    expect(suiAvailability(session.getSnapshot()).exportable).toBe(false)
    await retry
    expect(html(session)).not.toContain('>Passed<')
    expect(suiAvailability(session.getSnapshot()).exportable).toBe(false)
    request.mockResolvedValueOnce(simulation({ gasPaymentMocked: true }))
    await session.simulate()
    expect(session.getSnapshot().simulation).toBeUndefined()
    request.mockResolvedValueOnce(simulation({ checksEnabled: false }))
    await session.simulate()
    expect(session.getSnapshot().simulation).toBeUndefined()
    expect(disabled(html(session), 'Copy MSafe Plain Transaction')).toBe(true)
  })

  it('shows failed native simulation, mock gas and unverified authorization; never labels results approved', async () => {
    const request = vi.fn<SuiRequest>(async (action) =>
      action === 'inspect'
        ? inspection()
        : action === 'plan'
          ? plan()
          : {
              status: 'failed',
              checkedAt: new Date().toISOString(),
              packageHash: 'a'.repeat(64),
              transactionDigest: digest,
              gasPaymentMocked: true,
              authorizationVerified: false,
              gasUsed: { computationCost: '42' },
              balanceChanges: [],
              changedObjects: [],
              checksEnabled: true,
              warnings: ['Fixture native check failed.'],
            },
    )
    const { session } = await configuredSession(request)
    await session.build()
    await session.simulate()
    const markup = html(session)
    expect(markup).toContain('Native Sui simulation')
    expect(markup).toContain('Failed')
    expect(markup).toContain('Gas payment mocked')
    expect(markup).toContain('Authorization not verified')
    expect(markup).not.toContain('Passed')
    expect(markup).not.toContain('Approved')
    expect(disabled(markup, 'Copy MSafe Plain Transaction')).toBe(true)
    session.edit({ ackDestination: false })
    expect(session.getSnapshot().simulation).toBeUndefined()
  })

  it('discards a stale inspection after vault change, including its late errors', async () => {
    const late = deferred()
    const request = vi.fn<SuiRequest>(() => late.promise)
    const session = createSuiSession(request)
    session.edit({ vault })
    const pending = session.inspect()
    const signal = request.mock.calls[0]?.[2] as AbortSignal | undefined
    session.edit({ vault: destination })
    expect(signal?.aborted).toBe(true)
    late.resolve(inspection())
    await pending
    expect(session.getSnapshot().inspection).toBeUndefined()
    expect(html(session)).toContain('Not inspected')
    const rejected = deferred()
    const failing = createSuiSession(() => rejected.promise)
    failing.edit({ vault })
    const previous = failing.inspect()
    failing.edit({ evidenceDigest: digest })
    rejected.reject(new Error('private RPC secret payload'))
    await previous
    expect(failing.getSnapshot().error).toBeUndefined()
  })

  it('discards late build/simulation responses after edits and prevents concurrent actions', async () => {
    const built = deferred()
    const request = vi.fn<SuiRequest>(async (action) =>
      action === 'inspect' ? inspection() : built.promise,
    )
    const { session } = await configuredSession(request)
    const pending = session.build()
    await session.inspect()
    await session.simulate()
    expect(request.mock.calls.map(([action]) => action)).toEqual(['inspect', 'plan'])
    expect(disabled(html(session), 'Copy MSafe Plain Transaction')).toBe(true)
    session.edit({ objectIds: [] })
    built.resolve(plan())
    await pending
    expect(session.getSnapshot().plan).toBeUndefined()
    const simulated = deferred()
    const second = await configuredSession(
      vi.fn<SuiRequest>(async (action) =>
        action === 'inspect' ? inspection() : action === 'plan' ? plan() : simulated.promise,
      ),
    )
    await second.session.build()
    const pendingSimulation = second.session.simulate()
    second.session.edit({ signer: address(1) })
    simulated.resolve({ status: 'passed' })
    await pendingSimulation
    expect(second.session.getSnapshot().simulation).toBeUndefined()
    expect(disabled(html(second.session), 'Copy MSafe Plain Transaction')).toBe(true)
  })

  it('uses generic transport/decode errors and never echoes raw payloads or private RPC details', async () => {
    for (const request of [
      vi.fn(async () => {
        throw new Error('https://private.invalid/secret')
      }),
      vi.fn(async () => ({ privatePayload: 'secret', policy: null })),
    ]) {
      const session = createSuiSession(request)
      session.edit({ vault })
      await session.inspect()
      expect(session.getSnapshot().error).toBe('Sui request could not be completed. Try again.')
      expect(html(session)).not.toContain('private.invalid')
      expect(html(session)).not.toContain('privatePayload')
    }
  })

  it('expires exports and simulation after the bounded build lifetime without any automatic request', async () => {
    const { session, request } = await configuredSession()
    await session.build()
    request.mockResolvedValueOnce(simulation())
    await session.simulate()
    expect(suiAvailability(session.getSnapshot()).exportable).toBe(true)
    const created = Date.parse(session.getSnapshot().plan?.createdAt ?? '')
    expect(suiAvailability(session.getSnapshot(), created + 15 * 60 * 1000 + 1).exportable).toBe(
      false,
    )
    vi.setSystemTime(created + 15 * 60 * 1000 + 1)
    expect(html(session)).toContain('Expired; rebuild')
    await session.simulate()
    expect(request.mock.calls.map(([action]) => action)).toEqual(['inspect', 'plan', 'simulate'])
    expect(session.getSnapshot().error).toContain('expired')
  })
})

describe('fixed Sui request transport', () => {
  it('uses only the three fixed same-origin POST endpoints with abort support, never wallet or submit APIs', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    for (const action of ['inspect', 'plan', 'simulate'] as const)
      await requestSui(action, { fixture: true }, signal)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/other-chains/sui/inspect',
      '/api/other-chains/sui/plan',
      '/api/other-chains/sui/simulate',
    ])
    for (const [, options] of fetcher.mock.calls)
      expect(options).toMatchObject({
        method: 'POST',
        mode: 'same-origin',
        redirect: 'error',
        signal,
        body: '{"fixture":true}',
        headers: { 'X-SafeDesk-Readonly': '1' },
      })
  })

  it('shows allowlisted local guard errors but never raw SDK/provider messages', async () => {
    const allowed =
      'An incoming owner public key could not be resolved from bounded history. Supply a scheme-prefixed Base64 public key.'
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: allowed }), { status: 400 }),
    )
    vi.stubGlobal('fetch', fetcher)
    const session = createSuiSession()
    session.edit({ vault })
    await session.inspect()
    expect(session.getSnapshot().error).toBe(allowed)
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error:
            'An incoming owner public key could not be resolved from bounded history. https://private.invalid/secret',
        }),
        { status: 400 },
      ),
    )
    await session.inspect()
    expect(session.getSnapshot().error).toBe('Sui request could not be completed. Try again.')
  })
})
